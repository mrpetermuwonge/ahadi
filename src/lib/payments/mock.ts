import { getDb } from '../db';
import { hmac, randomId, safeEqual } from '../ids';
import type { PaymentProvider, GatewayStatus } from './types';
import { WebhookRejected } from './types';

/**
 * Built-in fake gateway. Simulates success, pending, failure, timeout and duplicate / out-of-order webhooks
 * so the whole app works end to end before any real keys exist.
 * Webhooks are signed with HMAC-SHA256(MOCK_WEBHOOK_SECRET, body) in the x-mock-signature header.
 */
export const MOCK_SECRET = () => process.env.MOCK_WEBHOOK_SECRET || 'mock-webhook-secret';

export const mockProvider: PaymentProvider = {
  name: 'mock',
  supports: () => true,
  isConfigured: () => true,

  async initiateCollection(req) {
    const db = await getDb();
    const ref = `MOCK-${randomId(10).toUpperCase()}`;
    await db.query(
      `INSERT INTO mock_transactions(ref, kind, reference, amount, currency, status) VALUES ($1,'collection',$2,$3,$4,'pending')`,
      [ref, req.reference, req.amount, req.currency],
    );
    return {
      status: 'pending',
      providerRef: ref,
      redirectUrl: req.method === 'card' ? `/mock-gateway/${ref}` : undefined,
    };
  },

  async getCollectionStatus(reference) {
    const db = await getDb();
    const [t] = await db.query(
      `SELECT * FROM mock_transactions WHERE reference=$1 AND kind='collection' ORDER BY created_at DESC LIMIT 1`,
      [reference],
    );
    if (!t) return { status: 'failed' };
    return { status: t.status as GatewayStatus, amount: Number(t.amount), currency: t.currency, providerRef: t.ref };
  },

  async handleWebhook(rawBody, headers) {
    const sig = headers.get('x-mock-signature') || '';
    if (!safeEqual(sig, hmac(MOCK_SECRET(), rawBody))) throw new WebhookRejected('bad signature');
    const p = JSON.parse(rawBody);
    return {
      eventId: String(p.id),
      kind: p.kind,
      reference: String(p.reference),
      status: p.status,
      amount: Number(p.amount),
      currency: String(p.currency),
      providerRef: p.ref,
    };
  },

  async initiatePayout(req) {
    const db = await getDb();
    const ref = `MOCKPO-${randomId(10).toUpperCase()}`;
    await db.query(
      `INSERT INTO mock_transactions(ref, kind, reference, amount, currency, status) VALUES ($1,'payout',$2,$3,$4,'succeeded')`,
      [ref, req.reference, req.amount, req.currency],
    );
    return { status: 'succeeded', providerRef: ref };
  },

  async getPayoutStatus(reference) {
    const db = await getDb();
    const [t] = await db.query(`SELECT * FROM mock_transactions WHERE reference=$1 AND kind='payout'`, [reference]);
    return { status: (t?.status as GatewayStatus) ?? 'failed', providerRef: t?.ref };
  },

  async refund(providerRef) {
    return { ok: true, providerRef: `${providerRef}-RF` };
  },
};

/** Build a signed mock webhook (used by the simulator and by tests). */
export function signedMockWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const headers = new Headers({ 'content-type': 'application/json', 'x-mock-signature': hmac(MOCK_SECRET(), body) });
  return { body, headers };
}
