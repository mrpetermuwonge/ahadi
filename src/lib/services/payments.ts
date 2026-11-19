import type { Db } from '../db';
import { APP_URL } from '../config';
import { newId, receiptNo } from '../ids';
import { post, paymentLines, chargedAmount, pledgeBalance, reverse } from '../ledger';
import { computeFee, formatMoney } from '../money';
import { providerByName, providersFor, markProviderDown } from '../payments';
import type { GatewayStatus, Method } from '../payments/types';
import { ProviderNotConfigured, WebhookRejected } from '../payments/types';
import { getSettings } from '../settings';
import { notify } from '../notify';
import { audit } from '../audit';
import { checkMilestones } from './milestones';
import { handlePayoutWebhook } from './payouts';
import type { EventType } from '../eventTypes';

/**
 * PAYMENT STATE MACHINE
 *   created -> pending -> succeeded | failed | expired
 *   expired/failed -> succeeded   (a verified late success: the money really was taken, so we record it)
 *   succeeded -> refunded
 * Anything else is ignored, which makes repeated or out-of-order webhooks harmless.
 * A payment becomes 'succeeded' ONLY from a verified webhook or a server-side status call,
 * and only if amount and currency match exactly what we asked for.
 */
export type PaymentStatus = 'created' | 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunding' | 'refunded';

export class PaymentError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

export interface QuoteInput {
  amount: number; // credited to the pledge
  coverFee: boolean;
  tip: number;
}

export async function quote(db: Db, q: QuoteInput, sombre: boolean) {
  const s = await getSettings(db);
  const fee = computeFee(q.amount, s.fee_percent, s.fee_min);
  const tipAllowed = s.tips_enabled && !sombre;
  const tip = tipAllowed ? Math.max(0, Math.floor(q.tip)) : 0;
  // If the fee would swallow the whole payment, the pledger must cover it.
  const coverFee = q.coverFee || fee >= q.amount;
  const split = { pledgeCredit: q.amount, fee, feeCovered: coverFee, tip };
  return { ...split, charged: chargedAmount(split), feePercent: s.fee_percent };
}

export interface StartPledgePayment {
  pledgeToken: string;
  amount: number;
  method: Method;
  phone?: string | null;
  coverFee: boolean;
  tip: number;
  idempotencyKey: string;
}

/** Create (or return the existing) payment for an idempotency key, then ask the gateway to collect. */
export async function startPledgePayment(db: Db, input: StartPledgePayment) {
  const existing = await db.query('SELECT * FROM payments WHERE idempotency_key=$1', [input.idempotencyKey]);
  if (existing[0]) return existing[0];

  const [pledge] = await db.query(
    `SELECT p.*, e.type AS event_type, e.frozen, e.status AS event_status, e.country, e.title, e.currency AS event_currency
       FROM pledges p JOIN events e ON e.id=p.event_id WHERE p.access_token=$1`,
    [input.pledgeToken],
  );
  if (!pledge) throw new PaymentError('pledge_not_found');
  if (pledge.disputed_at) throw new PaymentError('pledge_disputed');
  if (pledge.frozen || pledge.event_status !== 'active') throw new PaymentError('event_closed');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new PaymentError('invalid_amount');
  if (input.method !== 'card' && !input.phone) throw new PaymentError('phone_required');

  const settings = await getSettings(db);
  if (input.phone) {
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM payments WHERE payer_phone=$1 AND created_at > now() - interval '10 minutes'`,
      [input.phone],
    );
    if (n >= settings.velocity_max_payments_per_phone_per_10min) throw new PaymentError('too_many_attempts');
  }

  const sombre = pledge.event_type === 'hospital' || pledge.event_type === 'funeral';
  const qt = await quote(db, { amount: input.amount, coverFee: input.coverFee, tip: input.tip }, sombre);
  const candidates = providersFor(input.method, pledge.country);
  if (candidates.length === 0) throw new PaymentError('no_provider');

  const id = newId('pay');
  const inserted = await db.query(
    `INSERT INTO payments(id, idempotency_key, purpose, event_id, pledge_id, provider, method, payer_phone, currency,
                          pledge_credit, fee, fee_covered, tip, charged_amount, status, meta)
     VALUES ($1,$2,'pledge',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'created',$14)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [id, input.idempotencyKey, pledge.event_id, pledge.id, candidates[0].name, input.method, input.phone ?? null, pledge.currency,
     qt.pledgeCredit, qt.fee, qt.feeCovered, qt.tip, qt.charged, JSON.stringify({ feePercent: qt.feePercent })],
  );
  if (!inserted[0]) return (await db.query('SELECT * FROM payments WHERE idempotency_key=$1', [input.idempotencyKey]))[0];

  return initiateWithFallback(db, inserted[0], candidates.map((c) => c.name), `${pledge.title} pledge`);
}

/** Generic purchase (Event Pass, SMS credits) through the same gateway flow. */
export async function startPurchase(
  db: Db,
  p: { purpose: 'event_pass' | 'sms_credits'; userId: string; eventId: string | null; amount: number; method: Method; phone: string | null; idempotencyKey: string; currency: string },
) {
  const existing = await db.query('SELECT * FROM payments WHERE idempotency_key=$1', [p.idempotencyKey]);
  if (existing[0]) return existing[0];
  const candidates = providersFor(p.method, 'UG');
  if (candidates.length === 0) throw new PaymentError('no_provider');
  const [row] = await db.query(
    `INSERT INTO payments(id, idempotency_key, purpose, event_id, user_id, provider, method, payer_phone, currency, charged_amount, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created') ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [newId('pay'), p.idempotencyKey, p.purpose, p.eventId, p.userId, candidates[0].name, p.method, p.phone, p.currency, p.amount],
  );
  if (!row) return (await db.query('SELECT * FROM payments WHERE idempotency_key=$1', [p.idempotencyKey]))[0];
  return initiateWithFallback(db, row, candidates.map((c) => c.name), p.purpose === 'event_pass' ? 'Ahadi Event Pass' : 'Ahadi SMS credits');
}

async function initiateWithFallback(db: Db, payment: any, providerNames: string[], description: string) {
  for (const name of providerNames) {
    const provider = providerByName(name);
    const req = {
      reference: payment.id,
      idempotencyKey: payment.idempotency_key,
      amount: Number(payment.charged_amount),
      currency: payment.currency,
      method: payment.method as Method,
      phone: payment.payer_phone ?? undefined,
      description,
      callbackUrl: `${APP_URL()}/api/webhooks/${name}`,
      returnUrl: `${APP_URL()}/pay/${payment.id}`,
    };
    try {
      const r = await provider.initiateCollection(req);
      await logAttempt(db, payment.id, 'initiate', { provider: name, req: { ...req, phone: undefined } }, r, true);
      const status = r.status === 'pending' ? 'pending' : 'created';
      const [updated] = await db.query(
        `UPDATE payments SET provider=$2, provider_ref=$3, redirect_url=$4, status=$5, updated_at=now()
          WHERE id=$1 AND status='created' RETURNING *`,
        [payment.id, name, r.providerRef ?? null, r.redirectUrl ?? null, status],
      );
      if (r.status === 'succeeded' || r.status === 'failed') {
        await applyGatewayStatus(db, payment.id, r.status, { amount: req.amount, currency: req.currency, providerRef: r.providerRef }, 'initiate');
      }
      return updated ?? (await getPayment(db, payment.id));
    } catch (e) {
      await logAttempt(db, payment.id, 'initiate', { provider: name }, { error: String(e) }, false);
      if (!(e instanceof ProviderNotConfigured)) markProviderDown(name);
    }
  }
  const [failed] = await db.query(
    `UPDATE payments SET status='failed', failure_reason='gateway_unavailable', updated_at=now() WHERE id=$1 AND status='created' RETURNING *`,
    [payment.id],
  );
  return failed ?? (await getPayment(db, payment.id));
}

async function logAttempt(db: Db, paymentId: string, action: string, request: unknown, response: unknown, ok: boolean) {
  await db.query(
    `INSERT INTO payment_attempts(id, payment_id, action, request, response, ok) VALUES ($1,$2,$3,$4,$5,$6)`,
    [newId('att'), paymentId, action, JSON.stringify(request ?? null), JSON.stringify(response ?? null), ok],
  );
}

export async function getPayment(db: Db, id: string) {
  const [p] = await db.query('SELECT * FROM payments WHERE id=$1', [id]);
  return p ?? null;
}

/**
 * Apply a VERIFIED gateway status to a payment. Safe to call any number of times, in any order.
 * Returns what changed so callers can send notifications after the transaction commits.
 */
export async function applyGatewayStatus(
  db: Db,
  paymentId: string,
  status: GatewayStatus,
  info: { amount?: number; currency?: string; providerRef?: string },
  source: 'webhook' | 'status_check' | 'initiate' | 'job',
): Promise<{ changed: boolean; payment: any }> {
  const result = await db.tx(async (q) => {
    const [p] = await q.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]);
    if (!p) return { changed: false, payment: null, mismatch: false };

    if (status === 'succeeded') {
      // Already paid (or being / been refunded): a late or repeated "succeeded" changes nothing, receipt number included.
      if (p.status === 'succeeded' || p.status === 'refunding' || p.status === 'refunded') return { changed: false, payment: p, mismatch: false };
      // Amount and reference must match exactly, otherwise we never mark it paid.
      if (info.amount !== Number(p.charged_amount) || info.currency !== p.currency || (p.provider_ref && info.providerRef && info.providerRef !== p.provider_ref)) {
        await q.query(
          `INSERT INTO reconciliation_issues(id, run_date, payment_id, kind, details) VALUES ($1, CURRENT_DATE, $2, 'amount_mismatch', $3)`,
          [newId('rec'), p.id, JSON.stringify({ expected: Number(p.charged_amount), got: info.amount, currency: info.currency, source })],
        );
        return { changed: false, payment: p, mismatch: true };
      }
      const rno = receiptNo();
      const [u] = await q.query(
        `UPDATE payments SET status='succeeded', receipt_no=$2, succeeded_at=now(), updated_at=now(),
                provider_ref=COALESCE(provider_ref,$3), failure_reason=NULL WHERE id=$1 RETURNING *`,
        [p.id, rno, info.providerRef ?? null],
      );
      await postSuccess(q, u);
      await audit(q, { actor: null, action: 'payment.succeeded', entityType: 'payment', entityId: p.id, eventId: p.event_id, details: { source, from: p.status, amount: Number(p.charged_amount) } });
      return { changed: true, payment: u, mismatch: false };
    }

    if (status === 'failed' || status === 'expired') {
      if (p.status !== 'created' && p.status !== 'pending') return { changed: false, payment: p, mismatch: false };
      const [u] = await q.query(
        `UPDATE payments SET status=$2, failure_reason=COALESCE(failure_reason,$3), updated_at=now() WHERE id=$1 RETURNING *`,
        [p.id, status, status === 'failed' ? 'declined' : 'timeout'],
      );
      return { changed: true, payment: u, mismatch: false };
    }

    if (status === 'pending' && p.status === 'created') {
      const [u] = await q.query(`UPDATE payments SET status='pending', updated_at=now() WHERE id=$1 RETURNING *`, [p.id]);
      return { changed: true, payment: u, mismatch: false };
    }
    return { changed: false, payment: p, mismatch: false };
  });

  if (result.changed && result.payment?.status === 'succeeded') {
    await afterSuccess(db, result.payment).catch((e) => console.error('afterSuccess failed', e));
  }
  return { changed: result.changed, payment: result.payment };
}

/** Ledger + side tables for a successful payment. Runs inside the same transaction as the status change. */
async function postSuccess(q: Db, p: any) {
  if (p.purpose === 'pledge') {
    await post(q, {
      eventId: p.event_id,
      kind: 'payment',
      sourceType: 'payment',
      sourceId: p.id,
      currency: p.currency,
      receiptNo: p.receipt_no,
      lines: paymentLines(p.pledge_id, {
        pledgeCredit: Number(p.pledge_credit),
        fee: Number(p.fee),
        feeCovered: p.fee_covered,
        tip: Number(p.tip),
      }),
    });
    await q.query(
      `INSERT INTO fees(id, payment_id, event_id, fee_percent, amount, tip, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (payment_id) DO NOTHING`,
      [newId('fee'), p.id, p.event_id, Number(p.meta?.feePercent ?? 0), Number(p.fee), Number(p.tip), p.currency],
    );
  } else if (p.purpose === 'event_pass') {
    await post(q, {
      eventId: p.event_id,
      kind: 'pass',
      sourceType: 'payment',
      sourceId: p.id,
      currency: p.currency,
      receiptNo: p.receipt_no,
      lines: [
        { account: 'ahadi_cash', amount: Number(p.charged_amount) },
        { account: 'ahadi_pass_revenue', amount: -Number(p.charged_amount) },
      ],
    });
    await q.query(`INSERT INTO event_passes(id, event_id, payment_id) VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`, [newId('pass'), p.event_id, p.id]);
  } else if (p.purpose === 'sms_credits') {
    const s = await getSettings(q);
    await post(q, {
      eventId: null,
      kind: 'credits',
      sourceType: 'payment',
      sourceId: p.id,
      currency: p.currency,
      receiptNo: p.receipt_no,
      lines: [
        { account: 'ahadi_cash', amount: Number(p.charged_amount) },
        { account: 'ahadi_credit_revenue', amount: -Number(p.charged_amount) },
      ],
    });
    await q.query(`INSERT INTO credits(id, user_id, delta, reason, ref) VALUES ($1,$2,$3,'purchase',$4) ON CONFLICT DO NOTHING`, [newId('cr'), p.user_id, s.sms_bundle_size, p.id]);
  }
}

/** Notifications after commit: thank-you message (WhatsApp, SMS fallback) and organizer milestones. Never affects money state. */
async function afterSuccess(db: Db, p: any) {
  if (p.purpose !== 'pledge') return;
  const [row] = await db.query(
    `SELECT pl.name, pl.phone, pl.locale, pl.opted_out, e.title, e.type, e.id AS event_id FROM pledges pg
       JOIN pledgers pl ON pl.id=pg.pledger_id JOIN events e ON e.id=pg.event_id WHERE pg.id=$1`,
    [p.pledge_id],
  );
  if (row) {
    await notify(db, {
      to: row.phone, stage: 'thanks', eventType: row.type as EventType, locale: row.locale, purpose: 'thanks', eventId: row.event_id,
      vars: { name: row.name.split(' ')[0], event: row.title, amount: formatMoney(Number(p.pledge_credit), p.currency), link: `${APP_URL()}/r/${p.receipt_no}` },
    });
    // A fully paid pledge needs no more reminders.
    const bal = await pledgeBalance(db, p.pledge_id);
    if (bal.balance <= 0) {
      await db.query(`UPDATE reminders SET status='skipped', skip_reason='paid' WHERE pledge_id=$1 AND status='scheduled'`, [p.pledge_id]);
    }
  }
  await checkMilestones(db, p.event_id);
}

/** Server-side status check with the gateway (used when the browser polls and by the background job). */
export async function refreshPayment(db: Db, paymentId: string, opts: { force?: boolean } = {}) {
  const p = await getPayment(db, paymentId);
  if (!p || (p.status !== 'pending' && p.status !== 'created')) return p;
  const ageSec = (Date.now() - new Date(p.created_at).getTime()) / 1000;
  if (!opts.force && ageSec < 10) return p;
  try {
    const r = await providerByName(p.provider).getCollectionStatus(p.id, p.provider_ref);
    await logAttempt(db, p.id, 'status_check', null, r, true);
    if (r.status === 'succeeded') {
      await applyGatewayStatus(db, p.id, 'succeeded', { amount: r.amount, currency: r.currency, providerRef: r.providerRef }, 'status_check');
    } else if (r.status === 'failed' || r.status === 'expired') {
      await applyGatewayStatus(db, p.id, r.status, {}, 'status_check');
    }
  } catch (e) {
    await logAttempt(db, p.id, 'status_check', null, { error: String(e) }, false);
  }
  return getPayment(db, paymentId);
}

/**
 * Safe retry: only after the previous attempt is finished (failed/expired), or when a pending prompt is
 * confirmed still unanswered with the gateway (then it is expired first). The new idempotency key is derived
 * from the old one, so double-tapping "retry" still creates exactly one new payment.
 */
export async function retryPayment(db: Db, paymentId: string) {
  let p = await refreshPayment(db, paymentId, { force: true });
  if (!p) throw new PaymentError('not_found');
  if (p.status === 'succeeded') return p;
  if (p.status === 'pending' || p.status === 'created') {
    await applyGatewayStatus(db, p.id, 'expired', {}, 'job');
    if (p.provider === 'mock') await db.query(`UPDATE mock_transactions SET status='expired' WHERE reference=$1 AND status='pending'`, [p.id]);
    p = await getPayment(db, paymentId);
    if (p.status === 'succeeded') return p;
  }
  const [pledge] = await db.query('SELECT access_token FROM pledges WHERE id=$1', [p.pledge_id]);
  return startPledgePayment(db, {
    pledgeToken: pledge.access_token,
    amount: Number(p.pledge_credit),
    method: p.method,
    phone: p.payer_phone,
    coverFee: p.fee_covered,
    tip: Number(p.tip),
    idempotencyKey: `${p.idempotency_key}:retry`,
  });
}

/** Verify and apply a webhook. Replays (same provider event id) are dropped. */
export async function processWebhook(db: Db, providerName: string, rawBody: string, headers: Headers) {
  const provider = providerByName(providerName);
  let evt;
  try {
    evt = await provider.handleWebhook(rawBody, headers);
  } catch (e) {
    if (e instanceof WebhookRejected) return { ok: false as const, status: 401, reason: 'rejected' };
    throw e;
  }
  const fresh = await db.query(
    `INSERT INTO webhook_events(provider, event_id, payload) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id`,
    [providerName, evt.eventId, rawBody],
  );
  if (fresh.length === 0) return { ok: true as const, status: 200, reason: 'duplicate' };

  try {
    if (evt.kind === 'payout') {
      await handlePayoutWebhook(db, evt);
      return { ok: true as const, status: 200, reason: 'payout' };
    }
    const payment = await getPayment(db, evt.reference);
    if (!payment || payment.provider !== providerName) return { ok: true as const, status: 200, reason: 'unknown_reference' };
    const r = await applyGatewayStatus(db, payment.id, evt.status, { amount: evt.amount, currency: evt.currency, providerRef: evt.providerRef }, 'webhook');
    return { ok: true as const, status: 200, reason: r.changed ? 'applied' : 'no_change' };
  } catch (e) {
    // Not applied: forget we saw it, so the provider's retry is processed instead of being dropped as a duplicate.
    await db.query(`DELETE FROM webhook_events WHERE provider=$1 AND event_id=$2`, [providerName, evt.eventId]).catch(() => {});
    throw e;
  }
}

/**
 * Admin refund of a succeeded payment (Finance or Super admin, after a fresh code).
 *  1. Claim and reserve in one locked step: the payment becomes 'refunding' (two clicks can never refund twice)
 *     and, for a pledge payment, the organizer share moves from organizer_cash to refund_pending. The event row is
 *     locked like a withdrawal request, so a refund and a withdrawal can never take the same money.
 *  2. The provider refunds the payer. If that fails, the reservation is undone and the payment is 'succeeded' again.
 *  3. A reversing journal undoes the payment (pledge owed again, fee and tip reversed, Event Pass removed, bought
 *     message credits taken back) and the reservation is released, in one transaction.
 * If the app stops between 2 and 3, the money stays reserved (safe) and the daily check flags the stuck refund.
 */
export async function refundPayment(db: Db, paymentId: string, adminId: string, reason: string) {
  if (reason.trim().length < 10) throw new PaymentError('reason_required');
  // Conflict of interest: staff never refund payments of an event they are on the committee of.
  const [own] = await db.query(`SELECT 1 FROM payments p JOIN event_members m ON m.event_id=p.event_id WHERE p.id=$1 AND m.user_id=$2`, [paymentId, adminId]);
  if (own) throw new PaymentError('conflict_of_interest');

  const p = await db.tx(async (q) => {
    const [pay] = await q.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId]);
    if (!pay || pay.status !== 'succeeded') throw new PaymentError('not_refundable');
    let holdId: string | null = null;
    if (pay.purpose === 'pledge' && pay.event_id) {
      await q.query('SELECT id FROM events WHERE id=$1 FOR UPDATE', [pay.event_id]);
      const share = Number(pay.pledge_credit) - (pay.fee_covered ? 0 : Number(pay.fee)); // what organizer_cash received
      const [{ cash }] = await q.query<{ cash: number }>(
        `SELECT COALESCE(SUM(amount),0)::bigint AS cash FROM ledger_entries WHERE event_id=$1 AND account='organizer_cash'`, [pay.event_id]);
      if (Number(cash) < share) throw new PaymentError('refund_exceeds_available');
      if (share > 0) {
        holdId = (await post(q, {
          eventId: pay.event_id, kind: 'refund_hold', sourceType: 'refund', sourceId: newId('rfh'), currency: pay.currency, createdBy: adminId,
          memo: `Reserved for refund of ${pay.receipt_no ?? pay.id}`,
          lines: [{ account: 'refund_pending', amount: share }, { account: 'organizer_cash', amount: -share }],
        })).journalId;
      }
    }
    const [u] = await q.query(
      `UPDATE payments SET status='refunding', meta = meta || $2::jsonb, updated_at=now() WHERE id=$1 RETURNING *`,
      [pay.id, JSON.stringify({ refundHold: holdId })],
    );
    return u;
  });
  const holdId: string | null = p.meta?.refundHold ?? null;

  try {
    const provider = providerByName(p.provider);
    if (!provider.refund) throw new PaymentError('refund_not_supported');
    const r = await provider.refund(p.provider_ref, Number(p.charged_amount), p.currency);
    if (!r.ok) throw new PaymentError('refund_failed');
  } catch (e) {
    await db.tx(async (q) => {
      if (holdId) await reverse(q, holdId, adminId, 'Refund did not go through: reservation released');
      await q.query(`UPDATE payments SET status='succeeded', updated_at=now() WHERE id=$1 AND status='refunding'`, [p.id]);
    });
    throw e;
  }

  await db.tx(async (q) => {
    await q.query(`UPDATE payments SET status='refunded', updated_at=now() WHERE id=$1`, [p.id]);
    if (holdId) await reverse(q, holdId, adminId, 'Refund done: reservation released');
    const [j] = await q.query(`SELECT id FROM ledger_journals WHERE source_type='payment' AND source_id=$1 AND kind IN ('payment','pass','credits')`, [p.id]);
    if (j) await reverse(q, j.id, adminId, `Refund: ${reason.trim()}`);
    if (p.purpose === 'event_pass') await q.query(`DELETE FROM event_passes WHERE payment_id=$1`, [p.id]);
    if (p.purpose === 'sms_credits') {
      const [c] = await q.query(`SELECT delta FROM credits WHERE ref=$1 AND reason='purchase'`, [p.id]);
      if (c) await q.query(`INSERT INTO credits(id, user_id, delta, reason, ref) VALUES ($1,$2,$3,'refund',$4) ON CONFLICT DO NOTHING`, [newId('cr'), p.user_id, -Number(c.delta), p.id]);
    }
    await audit(q, { actor: adminId, action: 'payment.refunded', entityType: 'payment', entityId: p.id, eventId: p.event_id,
      details: { reason: reason.trim(), amount: Number(p.charged_amount), purpose: p.purpose } });
  });
}
