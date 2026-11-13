import type { Db } from '../db';
import { APP_URL } from '../config';
import type { EventType } from '../eventTypes';
import { newId } from '../ids';
import { pledgeBalance, unbalancedJournals } from '../ledger';
import { notify } from '../notify';
import { formatMoney } from '../money';
import { providerByName } from '../payments';
import { getSettings } from '../settings';
import { formatDate, nextAllowedTime, inQuietHours, localDate } from '../time';
import { applyGatewayStatus, refreshPayment } from './payments';
import { checkProcessingPayouts } from './payouts';

/** Organizer's SMS allowance: free per event, then the owner's purchased credits. */
async function takeSmsCredit(db: Db, eventId: string, reminderId: string): Promise<boolean> {
  const s = await getSettings(db);
  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM messages_log WHERE event_id=$1 AND purpose='reminder'`, [eventId]);
  if (n < s.free_sms_per_event) return true;
  const [owner] = await db.query(`SELECT created_by FROM events WHERE id=$1`, [eventId]);
  const [{ bal }] = await db.query<{ bal: number }>(`SELECT COALESCE(SUM(delta),0)::int AS bal FROM credits WHERE user_id=$1`, [owner.created_by]);
  if (bal <= 0) return false;
  await db.query(`INSERT INTO credits(id, user_id, delta, reason, ref) VALUES ($1,$2,-1,'reminder',$3) ON CONFLICT DO NOTHING`, [newId('cr'), owner.created_by, reminderId]);
  return true;
}

/** Send due reminders. Respects opt-outs, quiet hours (Africa/Kampala) and fully-paid pledges. */
export async function runReminders(db: Db, now = new Date()) {
  const s = await getSettings(db);
  const due = await db.query(
    `SELECT r.*, p.access_token, p.due_date, p.event_id, pl.name, pl.phone, pl.locale, pl.opted_out, e.title, e.type, e.currency, e.status AS event_status, e.frozen
       FROM reminders r JOIN pledges p ON p.id=r.pledge_id JOIN pledgers pl ON pl.id=p.pledger_id JOIN events e ON e.id=p.event_id
      WHERE r.status='scheduled' AND r.send_at <= $1 ORDER BY r.send_at LIMIT 500`,
    [now.toISOString()],
  );
  let sent = 0;
  for (const r of due) {
    const skip = async (reason: string) =>
      db.query(`UPDATE reminders SET status='skipped', skip_reason=$2 WHERE id=$1 AND status='scheduled'`, [r.id, reason]);
    if (r.opted_out) { await skip('opted_out'); continue; }
    if (r.event_status !== 'active' || r.frozen) { await skip('event_inactive'); continue; }
    const bal = await pledgeBalance(db, r.pledge_id);
    if (bal.balance <= 0) { await skip('paid'); continue; }
    if (inQuietHours(now, s.quiet_hours_start, s.quiet_hours_end)) {
      await db.query(`UPDATE reminders SET send_at=$2 WHERE id=$1`, [r.id, nextAllowedTime(now, s.quiet_hours_start, s.quiet_hours_end).toISOString()]);
      continue;
    }
    if (!(await takeSmsCredit(db, r.event_id, r.id))) { await skip('no_credits'); continue; }
    // Claim before sending so two job runs never send the same reminder.
    const claimed = await db.query(`UPDATE reminders SET status='sent', sent_at=now() WHERE id=$1 AND status='scheduled' RETURNING id`, [r.id]);
    if (claimed.length === 0) continue;
    const res = await notify(db, {
      to: r.phone, stage: r.stage, eventType: r.type as EventType, locale: r.locale, purpose: 'reminder', eventId: r.event_id,
      vars: { name: r.name.split(' ')[0], event: r.title, balance: formatMoney(bal.balance, r.currency), date: formatDate(r.due_date), link: `${APP_URL()}/p/${r.access_token}` },
    });
    await db.query(`UPDATE reminders SET channel=$2 WHERE id=$1`, [r.id, res.channel]);
    if (!res.ok) await db.query(`UPDATE reminders SET status='failed' WHERE id=$1`, [r.id]);
    else sent++;
  }
  return { checked: due.length, sent };
}

/** Pending payments older than the provider timeout are checked with the gateway, then expired. */
export async function runPendingPayments(db: Db) {
  const s = await getSettings(db);
  const rows = await db.query(
    `SELECT id, created_at FROM payments WHERE status IN ('created','pending') AND created_at < now() - ($1 || ' seconds')::interval`,
    [String(s.mobile_money_timeout_seconds)],
  );
  let expired = 0;
  for (const r of rows) {
    const p = await refreshPayment(db, r.id, { force: true });
    const ageMin = (Date.now() - new Date(r.created_at).getTime()) / 60000;
    // Gateways keep prompts open for a while; after 15 minutes with no answer we stop waiting.
    if (p && (p.status === 'pending' || p.status === 'created') && ageMin > 15) {
      await applyGatewayStatus(db, p.id, 'expired', {}, 'job');
      expired++;
    }
  }
  await checkProcessingPayouts(db);
  return { checked: rows.length, expired };
}

/** Daily reconciliation: ledger vs our payment records vs the provider's records. Differences go to the admin panel. */
export async function runReconciliation(db: Db, day = localDate(new Date(Date.now() - 86400000))) {
  const issues: { kind: string; paymentId?: string; details: unknown }[] = [];
  for (const j of await unbalancedJournals(db)) issues.push({ kind: 'unbalanced_journal', details: { journalId: j } });

  const succeeded = await db.query(
    `SELECT p.* FROM payments p WHERE p.status='succeeded' AND to_char(p.succeeded_at AT TIME ZONE 'Africa/Kampala','YYYY-MM-DD')=$1`,
    [day],
  );
  for (const p of succeeded) {
    const j = await db.query(`SELECT 1 FROM ledger_journals WHERE source_type='payment' AND source_id=$1`, [p.id]);
    if (j.length === 0) issues.push({ kind: 'missing_ledger', paymentId: p.id, details: {} });
    try {
      const r = await providerByName(p.provider).getCollectionStatus(p.id, p.provider_ref);
      if (r.status !== 'succeeded') issues.push({ kind: 'provider_status_differs', paymentId: p.id, details: { provider: r.status } });
      else if (r.amount !== undefined && r.amount !== Number(p.charged_amount)) issues.push({ kind: 'provider_amount_differs', paymentId: p.id, details: { ours: Number(p.charged_amount), theirs: r.amount } });
    } catch (e) {
      issues.push({ kind: 'provider_unreachable', paymentId: p.id, details: { error: String(e).slice(0, 200) } });
    }
  }
  for (const i of issues) {
    await db.query(`INSERT INTO reconciliation_issues(id, run_date, payment_id, kind, details) VALUES ($1,$2,$3,$4,$5)`, [
      newId('rec'), day, i.paymentId ?? null, i.kind, JSON.stringify(i.details),
    ]);
  }
  return { day, checked: succeeded.length, issues: issues.length };
}
