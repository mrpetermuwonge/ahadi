import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { refreshPayment } from '@/lib/services/payments';
import { api } from '@/lib/web';

/** Payment status for the status screen. Pending payments are re-checked with the gateway server-side. */
export const GET = api(async (_req, { params }: { params: { id: string } }) => {
  const p = await refreshPayment(await getDb(), params.id);
  if (!p) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    id: p.id,
    status: p.status,
    charged: Number(p.charged_amount),
    currency: p.currency,
    receiptNo: p.receipt_no,
    method: p.method,
    provider: p.provider,
  });
});
