import type { Db } from '../db';
import { PRIVACY_VERSION } from '../privacy';
import { APP_URL } from '../config';
import { audit } from '../audit';
import type { EventType } from '../eventTypes';
import { newId, randomId } from '../ids';
import { manualPaymentLines, pledgeBalance, pledgeChangeLines, pledgeLines, post, reverse } from '../ledger';
import { notify } from '../notify';
import { formatMoney } from '../money';
import { normalizePhone } from '../phone';
import { getSettings } from '../settings';
import { addDays, localDate, zonedTime } from '../time';
import { checkMilestones } from './milestones';

export class PledgeError extends Error {
  constructor(public code: string, public extra?: Record<string, unknown>) {
    super(code);
  }
}

export interface PledgeInput {
  eventId: string;
  name: string;
  phone: string;
  amount: number;
  message?: string | null;
  anonymous: boolean;
  payPlan: 'now' | 'part' | 'later';
  dueDate?: string | null;
  consent: boolean;
  locale?: string; // language of the pledge page; receipts and reminders use it
}

export async function hasEventPass(db: Db, eventId: string) {
  return (await db.query('SELECT 1 FROM event_passes WHERE event_id=$1', [eventId])).length > 0;
}

/**
 * Create a pledge (no account needed). The same phone pledging twice on one event does not
 * create a duplicate: the personal link is re-sent to that phone so its owner can update the pledge there.
 */
export async function createPledge(db: Db, input: PledgeInput) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new PledgeError('invalid_phone');
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) throw new PledgeError('invalid_name');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PledgeError('invalid_amount');
  if (!input.consent) throw new PledgeError('consent_required');
  const message = input.message?.trim().slice(0, 280) || null;
  const locale = ['en', 'lg', 'sw'].includes(input.locale ?? '') ? input.locale! : 'en';
  const today = localDate();
  let dueDate = input.payPlan === 'now' ? today : input.dueDate ?? null;
  if (input.payPlan !== 'now') {
    if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new PledgeError('due_date_required');
    if (dueDate < today) throw new PledgeError('due_date_past');
  }

  const [event] = await db.query('SELECT * FROM events WHERE id=$1', [input.eventId]);
  if (!event || event.status !== 'active' || event.frozen) throw new PledgeError('event_closed');
  const settings = await getSettings(db);

  const [{ n: recent }] = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM pledges p JOIN pledgers pl ON pl.id=p.pledger_id
      WHERE pl.phone=$1 AND p.created_at > now() - interval '1 hour'`,
    [phone],
  );
  if (recent >= settings.velocity_max_pledges_per_phone_per_hour) throw new PledgeError('too_many_pledges');

  const result = await db.tx(async (q) => {
    const [existingPledger] = await q.query('SELECT * FROM pledgers WHERE phone=$1', [phone]);
    let pledgerId: string;
    if (existingPledger) {
      pledgerId = existingPledger.id;
      await q.query('UPDATE pledgers SET name=$2, locale=$3, deleted_at=NULL, consent_at=now(), consent_version=$4 WHERE id=$1', [pledgerId, name, locale, PRIVACY_VERSION]);
    } else {
      pledgerId = newId('plr');
      await q.query('INSERT INTO pledgers(id, phone, name, locale, consent_at, consent_version) VALUES ($1,$2,$3,$4, now(), $5)', [pledgerId, phone, name, locale, PRIVACY_VERSION]);
    }

    const [dup] = await q.query('SELECT * FROM pledges WHERE event_id=$1 AND pledger_id=$2', [input.eventId, pledgerId]);
    if (dup) return { duplicate: true as const, pledge: dup };

    if (!(await hasEventPass(q, input.eventId))) {
      const [{ n }] = await q.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM pledges WHERE event_id=$1', [input.eventId]);
      if (n >= settings.free_max_pledges) throw new PledgeError('event_full');
    }

    const id = newId('plg');
    const [pledge] = await q.query(
      `INSERT INTO pledges(id, event_id, pledger_id, access_token, amount, currency, display_name, anonymous, message, pay_plan, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id, input.eventId, pledgerId, randomId(24), input.amount, event.currency, name, input.anonymous, message, input.payPlan, dueDate],
    );
    await post(q, { eventId: input.eventId, kind: 'pledge', sourceType: 'pledge', sourceId: id, currency: event.currency, lines: pledgeLines(id, input.amount) });
    return { duplicate: false as const, created: true, pledge };
  });

  if (result.duplicate) {
    // Never reveal the existing pledge to whoever typed this number: send its personal link to the phone itself.
    // The owner of the number can then pay or update the amount from that link.
    await notify(db, {
      to: phone, stage: 'pledged', eventType: event.type as EventType, locale, purpose: 'duplicate_link', eventId: event.id,
      vars: { name: name.split(' ')[0], event: event.title, amount: formatMoney(Number(result.pledge.amount), event.currency), link: `${APP_URL()}/p/${result.pledge.access_token}` },
    });
    throw new PledgeError('duplicate');
  }
  await scheduleReminders(db, result.pledge.id);
  await notify(db, {
    to: phone, stage: 'pledged', eventType: event.type as EventType, locale, purpose: 'pledged', eventId: event.id,
    vars: { name: name.split(' ')[0], event: event.title, amount: formatMoney(input.amount, event.currency), link: `${APP_URL()}/p/${result.pledge.access_token}` },
  });
  return result;
}

/**
 * Change a pledge amount. Increases apply immediately. A reduction by the pledger becomes a request the
 * organizer must approve; a reduction by the organizer (actor set) applies immediately.
 */
async function changePledgeAmountTx(q: Db, pledge: any, newAmount: number, actor: string | null) {
  const current = Number(pledge.amount);
  if (newAmount === current) return { applied: false, pendingApproval: false };
  if (newAmount < current && !actor) {
    const pending = await q.query(`SELECT 1 FROM pledge_change_requests WHERE pledge_id=$1 AND status='pending'`, [pledge.id]);
    if (pending.length) await q.query(`UPDATE pledge_change_requests SET status='rejected', decided_at=now() WHERE pledge_id=$1 AND status='pending'`, [pledge.id]);
    await q.query(`INSERT INTO pledge_change_requests(id, pledge_id, new_amount) VALUES ($1,$2,$3)`, [newId('pcr'), pledge.id, newAmount]);
    return { applied: false, pendingApproval: true };
  }
  const delta = newAmount - current;
  const changeId = newId('chg');
  await post(q, {
    eventId: pledge.event_id,
    kind: 'pledge_change',
    sourceType: 'change',
    sourceId: changeId,
    currency: pledge.currency,
    createdBy: actor,
    memo: `Pledge changed from ${current} to ${newAmount}`,
    lines: pledgeChangeLines(pledge.id, delta),
  });
  await q.query('UPDATE pledges SET amount=$2 WHERE id=$1', [pledge.id, newAmount]);
  await audit(q, { actor, action: 'pledge.amount_changed', entityType: 'pledge', entityId: pledge.id, eventId: pledge.event_id, details: { from: current, to: newAmount } });
  return { applied: true, pendingApproval: false };
}

export async function pledgerChangeAmount(db: Db, token: string, newAmount: number) {
  if (!Number.isSafeInteger(newAmount) || newAmount <= 0) throw new PledgeError('invalid_amount');
  return db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM pledges WHERE access_token=$1 FOR UPDATE', [token]);
    if (!p) throw new PledgeError('not_found');
    return changePledgeAmountTx(q, p, newAmount, null);
  });
}

export async function organizerChangeAmount(db: Db, pledgeId: string, newAmount: number, actor: string) {
  if (!Number.isSafeInteger(newAmount) || newAmount <= 0) throw new PledgeError('invalid_amount');
  return db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM pledges WHERE id=$1 FOR UPDATE', [pledgeId]);
    if (!p) throw new PledgeError('not_found');
    return changePledgeAmountTx(q, p, newAmount, actor);
  });
}

export async function decideChangeRequest(db: Db, requestId: string, approve: boolean, actor: string) {
  return db.tx(async (q) => {
    const [r] = await q.query(`SELECT * FROM pledge_change_requests WHERE id=$1 AND status='pending' FOR UPDATE`, [requestId]);
    if (!r) throw new PledgeError('not_found');
    const [p] = await q.query('SELECT * FROM pledges WHERE id=$1 FOR UPDATE', [r.pledge_id]);
    if (approve) await changePledgeAmountTx(q, p, Number(r.new_amount), actor);
    await q.query(`UPDATE pledge_change_requests SET status=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [requestId, approve ? 'approved' : 'rejected', actor]);
    await audit(q, { actor, action: approve ? 'pledge.reduction_approved' : 'pledge.reduction_rejected', entityType: 'pledge', entityId: p.id, eventId: p.event_id, details: { newAmount: Number(r.new_amount) } });
    return p.event_id as string;
  });
}

/** Treasurer records cash / offline money. Audit-logged; can only be corrected by a reversing entry. */
export async function recordManualPayment(
  db: Db,
  a: { pledgeId: string; amount: number; reason: string; receiptRef: string; actor: string },
) {
  if (!Number.isSafeInteger(a.amount) || a.amount <= 0) throw new PledgeError('invalid_amount');
  if (a.reason.trim().length < 3) throw new PledgeError('reason_required');
  const eventId = await db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM pledges WHERE id=$1', [a.pledgeId]);
    if (!p) throw new PledgeError('not_found');
    const id = newId('man');
    const { journalId } = await post(q, {
      eventId: p.event_id,
      kind: 'manual_payment',
      sourceType: 'manual',
      sourceId: id,
      currency: p.currency,
      createdBy: a.actor,
      receiptNo: a.receiptRef.trim().slice(0, 60) || null,
      memo: a.reason.trim().slice(0, 200),
      lines: manualPaymentLines(p.id, a.amount),
    });
    await audit(q, { actor: a.actor, action: 'ledger.manual_payment', entityType: 'journal', entityId: journalId, eventId: p.event_id, details: { pledgeId: p.id, amount: a.amount, reason: a.reason, receipt: a.receiptRef } });
    return p.event_id as string;
  });
  await checkMilestones(db, eventId);
}

export async function reverseManualEntry(db: Db, journalId: string, actor: string, reason: string) {
  if (reason.trim().length < 3) throw new PledgeError('reason_required');
  return db.tx(async (q) => {
    const [j] = await q.query('SELECT * FROM ledger_journals WHERE id=$1', [journalId]);
    if (!j || j.kind !== 'manual_payment') throw new PledgeError('not_reversible');
    const r = await reverse(q, journalId, actor, reason.trim().slice(0, 200));
    await audit(q, { actor, action: 'ledger.reversal', entityType: 'journal', entityId: r.journalId, eventId: j.event_id, details: { reverses: journalId, reason } });
    return j.event_id as string;
  });
}

/** Create reminder rows for a pledge from the event's schedule (09:00 Africa/Kampala on each day). */
export async function scheduleReminders(db: Db, pledgeId: string) {
  const [p] = await db.query(
    `SELECT p.*, e.reminder_offsets FROM pledges p JOIN events e ON e.id=p.event_id WHERE p.id=$1`,
    [pledgeId],
  );
  if (!p?.due_date) return;
  await db.query(`DELETE FROM reminders WHERE pledge_id=$1 AND status='scheduled'`, [pledgeId]);
  const now = new Date();
  for (const offset of p.reminder_offsets as number[]) {
    const day = addDays(p.due_date, -offset);
    const at = zonedTime(day, 9);
    if (at <= now) continue;
    const stage = offset > 0 ? 'before' : offset === 0 ? 'due' : 'after';
    await db.query(
      `INSERT INTO reminders(id, pledge_id, channel, stage, send_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [newId('rem'), pledgeId, 'whatsapp', stage, at.toISOString()],
    );
  }
}

/** Pledger privacy rights: export their data, or delete it (amounts stay in the ledger, identity is removed). */
export async function exportPledgerData(db: Db, token: string) {
  const [p] = await db.query('SELECT pledger_id FROM pledges WHERE access_token=$1', [token]);
  if (!p) throw new PledgeError('not_found');
  const [pledger] = await db.query('SELECT name, phone, opted_out, consent_at, created_at FROM pledgers WHERE id=$1', [p.pledger_id]);
  const pledges = await db.query(
    `SELECT e.title, pg.amount, pg.currency, pg.message, pg.due_date, pg.created_at FROM pledges pg JOIN events e ON e.id=pg.event_id WHERE pg.pledger_id=$1`,
    [p.pledger_id],
  );
  const payments = await db.query(
    `SELECT pay.receipt_no, pay.charged_amount, pay.currency, pay.status, pay.created_at FROM payments pay JOIN pledges pg ON pg.id=pay.pledge_id WHERE pg.pledger_id=$1`,
    [p.pledger_id],
  );
  return { pledger, pledges, payments };
}

export async function deletePledgerData(db: Db, token: string) {
  const [p] = await db.query('SELECT pledger_id FROM pledges WHERE access_token=$1', [token]);
  if (!p) throw new PledgeError('not_found');
  await erasePledger(db, p.pledger_id, null, 'self');
}

/**
 * Right to erasure: remove a pledger's name, phone number and messages everywhere. Amounts stay in the ledger
 * (accounting duty) but can no longer be linked to the person. Also used by Ahadi staff for requests by phone.
 */
async function erasePledger(db: Db, pledgerId: string, actor: string | null, via: 'self' | 'admin') {
  await db.tx(async (q) => {
    const [pl] = await q.query('SELECT phone FROM pledgers WHERE id=$1', [pledgerId]);
    const phone: string | undefined = pl?.phone;
    const anonPhone = `deleted:${pledgerId}`;
    await q.query(`UPDATE pledgers SET name='Deleted', phone=$2, opted_out=true, deleted_at=now() WHERE id=$1`, [pledgerId, anonPhone]);
    await q.query(`UPDATE pledges SET display_name='Deleted', message=NULL, anonymous=true WHERE pledger_id=$1`, [pledgerId]);
    await q.query(`UPDATE payments SET payer_phone=NULL WHERE pledge_id IN (SELECT id FROM pledges WHERE pledger_id=$1)`, [pledgerId]);
    await q.query(`UPDATE reminders SET status='skipped', skip_reason='deleted' WHERE status='scheduled' AND pledge_id IN (SELECT id FROM pledges WHERE pledger_id=$1)`, [pledgerId]);
    if (phone && phone.startsWith('+')) {
      await q.query(`UPDATE messages_log SET recipient=$2, body='[deleted on request]' WHERE recipient=$1`, [phone, anonPhone]);
      await q.query(`DELETE FROM otp_codes WHERE identifier=$1`, [phone]);
      await q.query(`DELETE FROM pledger_devices WHERE phone=$1`, [phone]);
    }
    await audit(q, { actor, action: 'pledger.deleted', entityType: 'pledger', entityId: pledgerId, details: { via } });
  });
}

/** Staff: erase a pledger's personal data after a request by phone or email to Ahadi. */
export async function erasePledgerByPhone(db: Db, rawPhone: string, actor: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new PledgeError('invalid_phone');
  const [p] = await db.query('SELECT id FROM pledgers WHERE phone=$1', [phone]);
  if (!p) throw new PledgeError('not_found');
  await erasePledger(db, p.id, actor, 'admin');
}

export async function getPledgeView(db: Db, token: string) {
  const [p] = await db.query(
    `SELECT pg.*, pl.name AS pledger_name, pl.phone, pl.opted_out, e.title, e.type, e.slug, e.currency AS event_currency, e.status AS event_status, e.frozen
       FROM pledges pg JOIN pledgers pl ON pl.id=pg.pledger_id JOIN events e ON e.id=pg.event_id WHERE pg.access_token=$1`,
    [token],
  );
  if (!p) return null;
  const balance = await pledgeBalance(db, p.id);
  const payments = await db.query(
    `SELECT id, receipt_no, pledge_credit, charged_amount, status, method, created_at FROM payments WHERE pledge_id=$1 ORDER BY created_at DESC`,
    [p.id],
  );
  const [pendingChange] = await db.query(`SELECT * FROM pledge_change_requests WHERE pledge_id=$1 AND status='pending'`, [p.id]);
  // Money the treasurer recorded as given to the committee (cash, bank, mobile money to them): not through Ahadi.
  const offline = await db.query<{ id: string; amount: number; created_at: string }>(
    `SELECT j.id, j.created_at, (-SUM(le.amount))::bigint AS amount
       FROM ledger_journals j JOIN ledger_entries le ON le.journal_id=j.id
      WHERE le.pledge_id=$1 AND le.account='receivable' AND j.kind='manual_payment'
        AND NOT EXISTS (SELECT 1 FROM ledger_journals r WHERE r.reverses_id=j.id)
      GROUP BY j.id, j.created_at ORDER BY j.created_at DESC`,
    [p.id],
  );
  return { pledge: p, balance, payments, offline, pendingChange: pendingChange ?? null };
}
