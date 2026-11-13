import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { PaymentError, startPledgePayment } from '@/lib/services/payments';
import { api } from '@/lib/web';

const Body = z.object({
  pledgeToken: z.string().min(10).max(64),
  amount: z.number().int().positive().max(1e12),
  method: z.enum(['mtn', 'airtel', 'card']),
  phone: z.string().max(30).nullable().optional(),
  coverFee: z.boolean(),
  tip: z.number().int().min(0).max(1e9),
  idempotencyKey: z.string().min(16).max(80),
});

/** Public: start paying a pledge. The idempotency key makes double taps and resends return the same payment. */
export const POST = api(async (req) => {
  const b = Body.parse(await req.json());
  let phone: string | null = null;
  if (b.method !== 'card') {
    phone = normalizePhone(b.phone ?? '');
    if (!phone) throw new PaymentError('invalid_phone');
  }
  const p = await startPledgePayment(await getDb(), { ...b, phone, idempotencyKey: `pledge:${b.idempotencyKey}` });
  return NextResponse.json({ id: p.id, status: p.status, redirectUrl: p.status === 'pending' ? p.redirect_url : null });
});
