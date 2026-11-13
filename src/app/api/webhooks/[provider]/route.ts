import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { processWebhook } from '@/lib/services/payments';

/**
 * Gateway webhooks. No CSRF/origin check (gateways post server-to-server); instead every webhook is
 * verified by the provider adapter, replays are dropped, and amounts must match before money is recorded.
 */
export async function POST(req: Request, { params }: { params: { provider: string } }) {
  if (!['mock', 'zengapay', 'dpo'].includes(params.provider)) return NextResponse.json({ error: 'unknown' }, { status: 404 });
  const raw = await req.text();
  try {
    const r = await processWebhook(await getDb(), params.provider, raw, req.headers);
    return NextResponse.json({ ok: r.ok, result: r.reason }, { status: r.status });
  } catch (e) {
    console.error('webhook error', e);
    // 500 makes the gateway retry later, which is safe because processing is idempotent.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
