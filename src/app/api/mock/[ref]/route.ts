import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { signedMockWebhook } from '@/lib/payments/mock';
import { processWebhook } from '@/lib/services/payments';
import { api, jsonError } from '@/lib/web';

const Body = z.object({ outcome: z.enum(['success', 'fail', 'timeout', 'duplicate']) });

/**
 * Mock gateway simulator: plays the role of the payer's phone / card page.
 * It sends real signed webhooks through the same code path real gateways use.
 * "duplicate" delivers the success webhook twice and then a stale "failed" webhook out of order.
 */
export const POST = api(async (req, { params }: { params: { ref: string } }) => {
  if (!(process.env.PAYMENT_PROVIDERS || 'mock').split(',').includes('mock')) return jsonError('not_found', 404);
  const { outcome } = Body.parse(await req.json());
  const db = await getDb();
  const [tx] = await db.query(`SELECT * FROM mock_transactions WHERE ref=$1 AND kind='collection'`, [params.ref]);
  if (!tx) return jsonError('not_found', 404);
  if (outcome === 'timeout') return NextResponse.json({ ok: true });
  if (tx.status !== 'pending') return NextResponse.json({ ok: true, status: tx.status });

  const status = outcome === 'fail' ? 'failed' : 'succeeded';
  await db.query(`UPDATE mock_transactions SET status=$2 WHERE ref=$1 AND status='pending'`, [tx.ref, status]);
  const payload = { id: `${tx.ref}:${status}`, kind: 'collection', reference: tx.reference, ref: tx.ref, status, amount: Number(tx.amount), currency: tx.currency };
  const deliveries = outcome === 'duplicate'
    ? [payload, payload, { ...payload, id: `${tx.ref}:late-failed`, status: 'failed' }]
    : [payload];
  const results = [];
  for (const p of deliveries) {
    const { body, headers } = signedMockWebhook(p);
    results.push((await processWebhook(db, 'mock', body, headers)).reason);
  }
  return NextResponse.json({ ok: true, results });
});
