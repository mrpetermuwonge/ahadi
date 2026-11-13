import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { safeEqual } from '@/lib/ids';
import { handleWhatsAppStatus } from '@/lib/notify';

/**
 * WhatsApp Business Platform webhook (configure in the Meta app: Callback URL = {APP_URL}/api/webhooks/whatsapp,
 * Verify token = WHATSAPP_VERIFY_TOKEN, subscribe to the "messages" field).
 *   GET  – Meta's one-time verification handshake.
 *   POST – delivery statuses (failed → SMS fallback). Pledgers cannot switch reminders off by replying.
 * Every POST must carry X-Hub-Signature-256 = HMAC-SHA256(WHATSAPP_APP_SECRET, raw body).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get('hub.mode') === 'subscribe' && safeEqual(u.searchParams.get('hub.verify_token') ?? '', token)) {
    return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const expected = secret ? 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') : '';
  if (!secret || !safeEqual(sig, expected)) return NextResponse.json({ error: 'forbidden' }, { status: 401 });

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const db = await getDb();
  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {};
        for (const s of v.statuses ?? []) if (s?.id && s?.status) await handleWhatsAppStatus(db, String(s.id), String(s.status));
      }
    }
  } catch (e) {
    console.error('whatsapp webhook', e);
    return NextResponse.json({ ok: false }, { status: 500 }); // Meta retries; handlers are idempotent
  }
  return NextResponse.json({ ok: true });
}
