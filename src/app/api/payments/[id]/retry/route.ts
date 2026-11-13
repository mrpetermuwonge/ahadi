import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { retryPayment } from '@/lib/services/payments';
import { api } from '@/lib/web';

/** Safe retry / resend prompt. Cannot double-charge: see retryPayment. */
export const POST = api(async (_req, { params }: { params: { id: string } }) => {
  const p = await retryPayment(await getDb(), params.id);
  return NextResponse.json({ id: p.id, status: p.status, redirectUrl: p.status === 'pending' ? p.redirect_url : null });
});
