import type { Db } from '../db';
import { audit } from '../audit';
import { alertPayoutRequested } from './committeeAlerts';
import { EVENT_TYPES, type EventType } from '../eventTypes';
import { newId } from '../ids';
import { eventTotals, post, reverse } from '../ledger';
import { providerByName, providersFor } from '../payments';
import type { WebhookEvent } from '../payments/types';

/**
 * PAYOUTS. Money moves out only to a verified account, only up to the organizer's available balance.
 *
 *   request -> [awaiting_second_approval] -> [in_review] -> processing -> paid | failed
 *                                                         \-> rejected (admin)
 * Requesting places a hold (organizer_cash -> payout_pending) so the same money cannot be requested twice.
 * Failure or rejection reverses the hold.
 */
export class PayoutError extends Error {}

async function nextGate(q: Db, event: any, requestedBy: string): Promise<'in_review' | 'processing'> {
  const tpl = EVENT_TYPES[event.type as EventType];
  const [{ n }] = await q.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM payouts p JOIN events e ON e.id=p.event_id WHERE e.created_by=$1 AND p.status='paid'`,
    [event.created_by],
  );
  const firstForOrganizer = n === 0;
  if (firstForOrganizer || (tpl.requiresVerification && !event.verified)) return 'in_review';
  void requestedBy;
  return 'processing';
}

export async function requestPayout(db: Db, a: { eventId: string; userId: string; accountId: string; amount: number }) {
  if (!Number.isSafeInteger(a.amount) || a.amount <= 0) throw new PayoutError('invalid_amount');
  const payout = await db.tx(async (q) => {
    const [e] = await q.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [a.eventId]);
    if (!e) throw new PayoutError('not_found');
    if (e.frozen) throw new PayoutError('event_frozen');
    const [acct] = await q.query('SELECT * FROM payout_accounts WHERE id=$1 AND user_id=$2', [a.accountId, a.userId]);
    if (!acct) throw new PayoutError('account_not_found');
    if (!acct.verified) throw new PayoutError('account_not_verified');
    const totals = await eventTotals(q, a.eventId);
    if (a.amount > totals.available) throw new PayoutError('insufficient_balance');

    const tpl = EVENT_TYPES[e.type as EventType];
    const [{ n }] = await q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM payouts WHERE event_id=$1 AND status='paid'`, [a.eventId]);
    const status = tpl.secondApproverForFirstPayout && n === 0 ? 'awaiting_second_approval' : await nextGate(q, e, a.userId);

    const id = newId('po');
    const [p] = await q.query(
      `INSERT INTO payouts(id, event_id, account_id, amount, currency, status, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, a.eventId, a.accountId, a.amount, e.currency, status, a.userId],
    );
    await post(q, {
      eventId: a.eventId,
      kind: 'payout_hold',
      sourceType: 'payout',
      sourceId: id,
      currency: e.currency,
      createdBy: a.userId,
      lines: [
        { account: 'payout_pending', amount: a.amount },
        { account: 'organizer_cash', amount: -a.amount },
      ],
    });
    await audit(q, { actor: a.userId, action: 'payout.requested', entityType: 'payout', entityId: id, eventId: a.eventId, details: { amount: a.amount, status } });
    return p;
  });
  // Tell the treasurer(s) and other organizers straight away, so a withdrawal is never a surprise.
  await alertPayoutRequested(db, payout);
  if (payout.status === 'processing') await executePayout(db, payout.id);
  return payout;
}

/** Second committee member approves (hospital / funeral first payout). Must not be the requester. */
export async function secondApprove(db: Db, payoutId: string, userId: string) {
  const p = await db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [payoutId]);
    if (!p || p.status !== 'awaiting_second_approval') throw new PayoutError('not_awaiting_approval');
    if (p.requested_by === userId) throw new PayoutError('same_person');
    const [m] = await q.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2`, [p.event_id, userId]);
    if (!m || !['owner', 'treasurer'].includes(m.role)) throw new PayoutError('forbidden');
    const [e] = await q.query('SELECT * FROM events WHERE id=$1', [p.event_id]);
    const status = await nextGate(q, e, p.requested_by);
    const [u] = await q.query(`UPDATE payouts SET status=$2, second_approver=$3, updated_at=now() WHERE id=$1 RETURNING *`, [payoutId, status, userId]);
    await audit(q, { actor: userId, action: 'payout.second_approved', entityType: 'payout', entityId: payoutId, eventId: p.event_id });
    return u;
  });
  if (p.status === 'processing') await executePayout(db, p.id);
  return p;
}

export async function adminReview(db: Db, payoutId: string, adminId: string, approve: boolean, note: string) {
  const p = await db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE', [payoutId]);
    if (!p || p.status !== 'in_review') throw new PayoutError('not_in_review');
    // Conflict of interest: Ahadi staff never review a withdrawal from an event they are on the committee of.
    const [own] = await q.query(`SELECT 1 FROM event_members WHERE event_id=$1 AND user_id=$2`, [p.event_id, adminId]);
    if (own || p.requested_by === adminId) throw new PayoutError('conflict_of_interest');
    if (approve) {
      const [u] = await q.query(`UPDATE payouts SET status='processing', reviewed_by=$2, updated_at=now() WHERE id=$1 RETURNING *`, [payoutId, adminId]);
      await audit(q, { actor: adminId, action: 'payout.approved', entityType: 'payout', entityId: payoutId, eventId: p.event_id, details: { note } });
      return u;
    }
    const [u] = await q.query(`UPDATE payouts SET status='rejected', reviewed_by=$2, failure_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`, [payoutId, adminId, note]);
    await releaseHold(q, payoutId, adminId, `Rejected: ${note}`);
    await audit(q, { actor: adminId, action: 'payout.rejected', entityType: 'payout', entityId: payoutId, eventId: p.event_id, details: { note } });
    return u;
  });
  if (p.status === 'processing') await executePayout(db, p.id);
  return p;
}

async function releaseHold(q: Db, payoutId: string, actor: string | null, memo: string) {
  const [j] = await q.query(`SELECT id FROM ledger_journals WHERE kind='payout_hold' AND source_type='payout' AND source_id=$1`, [payoutId]);
  if (j) await reverse(q, j.id, actor, memo);
}

async function markPaid(q: Db, p: any, providerRef?: string) {
  const [u] = await q.query(`UPDATE payouts SET status='paid', provider_ref=COALESCE($2, provider_ref), updated_at=now() WHERE id=$1 AND status='processing' RETURNING *`, [p.id, providerRef ?? null]);
  if (!u) return;
  await post(q, {
    eventId: p.event_id,
    kind: 'payout_paid',
    sourceType: 'payout',
    sourceId: p.id,
    currency: p.currency,
    lines: [
      { account: 'paid_out', amount: Number(p.amount) },
      { account: 'payout_pending', amount: -Number(p.amount) },
    ],
  });
  await audit(q, { actor: null, action: 'payout.paid', entityType: 'payout', entityId: p.id, eventId: p.event_id });
}

async function markFailed(q: Db, p: any, reason: string) {
  const [u] = await q.query(`UPDATE payouts SET status='failed', failure_reason=$2, updated_at=now() WHERE id=$1 AND status='processing' RETURNING *`, [p.id, reason]);
  if (!u) return;
  await releaseHold(q, p.id, null, `Payout failed: ${reason}`);
  await audit(q, { actor: null, action: 'payout.failed', entityType: 'payout', entityId: p.id, eventId: p.event_id, details: { reason } });
}

export async function executePayout(db: Db, payoutId: string) {
  const [p] = await db.query('SELECT * FROM payouts WHERE id=$1', [payoutId]);
  if (!p || p.status !== 'processing' || p.provider_ref) return;
  const [acct] = await db.query('SELECT * FROM payout_accounts WHERE id=$1', [p.account_id]);
  const provider = providersFor('mtn', 'UG')[0];
  if (!provider) return; // stays processing; the job retries
  try {
    const r = await provider.initiatePayout({
      reference: p.id,
      idempotencyKey: `payout:${p.id}`,
      amount: Number(p.amount),
      currency: p.currency,
      destination:
        acct.kind === 'bank'
          ? { kind: 'bank', bankName: acct.bank_name, accountNo: acct.account_no, accountName: acct.account_name }
          : { kind: 'mobile_money', phone: acct.phone },
      description: 'Ahadi payout',
    });
    await db.query(`UPDATE payouts SET provider=$2, provider_ref=$3, updated_at=now() WHERE id=$1`, [p.id, provider.name, r.providerRef ?? null]);
    if (r.status === 'succeeded') await db.tx((q) => markPaid(q, p, r.providerRef));
    else if (r.status === 'failed') await db.tx((q) => markFailed(q, p, 'gateway_declined'));
  } catch (e) {
    await db.tx((q) => markFailed(q, p, String(e).slice(0, 200)));
  }
}

export async function handlePayoutWebhook(db: Db, evt: WebhookEvent) {
  const [p] = await db.query('SELECT * FROM payouts WHERE id=$1', [evt.reference]);
  if (!p || p.status !== 'processing') return;
  if (evt.amount !== Number(p.amount)) return;
  if (evt.status === 'succeeded') await db.tx((q) => markPaid(q, p, evt.providerRef));
  else if (evt.status === 'failed') await db.tx((q) => markFailed(q, p, 'gateway_declined'));
}

/** Background job: confirm payouts stuck in processing with the gateway. */
export async function checkProcessingPayouts(db: Db) {
  const rows = await db.query(`SELECT * FROM payouts WHERE status='processing'`);
  for (const p of rows) {
    if (!p.provider_ref) {
      await executePayout(db, p.id);
      continue;
    }
    const r = await providerByName(p.provider).getPayoutStatus(p.id, p.provider_ref).catch(() => null);
    if (r?.status === 'succeeded') await db.tx((q) => markPaid(q, p, r.providerRef));
    else if (r?.status === 'failed') await db.tx((q) => markFailed(q, p, 'gateway_declined'));
  }
}
