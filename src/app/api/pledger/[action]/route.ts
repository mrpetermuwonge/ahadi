import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { api, jsonError } from '@/lib/web';
import { maskPhone } from '@/lib/phone';
import { rolesForPhone } from '@/lib/services/login';
import {
  DEVICE_COOKIE, VERIFY_MINUTES, devicePhone, forgetDevice, pledgerSummary, sendCodeForPledge, sendPledgerCode, verifyForPledge, verifyPledger,
} from '@/lib/services/pledgerAccess';

/**
 * Pledger verification (no account, nothing permanent):
 *   GET  /api/pledger/me      – the number verified on this browser in the last 15 minutes, with its pledges
 *   POST /api/pledger/code    – send a one-time code to a phone (WhatsApp, SMS fallback)
 *   POST /api/pledger/verify  – check { phone, code }; opens a 15-minute verification
 *   POST /api/pledger/pledge-code   – personal link opened: send the code to that pledge's own number
 *   POST /api/pledger/pledge-verify – { token, code } for a personal link
 *   POST /api/pledger/forget  – end the verification now (leaving the portal, "Not you?")
 */
async function me(token: string | undefined) {
  const db = await getDb();
  const phone = await devicePhone(db, token);
  if (!phone) return { verified: false as const };
  const roles = await rolesForPhone(db, phone);
  const summary = await pledgerSummary(db, phone);
  // Someone who has not pledged yet may still have a name on their organizer account.
  const [u] = summary.name ? [] : await db.query('SELECT name FROM users WHERE phone=$1', [phone]);
  return { verified: true as const, phone, ...summary, name: summary.name ?? u?.name ?? null, runsEvents: roles.runsEvents || roles.isAdmin };
}

export const GET = api(async (_req, { params }: { params: { action: string } }) => {
  if (params.action !== 'me') return jsonError('not_found', 404);
  return NextResponse.json(await me(cookies().get(DEVICE_COOKIE)?.value), { headers: { 'cache-control': 'private, no-store' } });
});

export const POST = api(async (req, { params }: { params: { action: string } }) => {
  const db = await getDb();
  const body = await req.json().catch(() => ({}));
  switch (params.action) {
    case 'code': {
      const b = z.object({ phone: z.string().max(30), locale: z.string().max(5).optional() }).parse(body);
      const r = await sendPledgerCode(db, b.phone, b.locale);
      return NextResponse.json({ channel: r.channel, phone: r.identifier, devCode: r.devCode });
    }
    case 'verify': {
      const b = z.object({ phone: z.string().max(30), code: z.string().max(6) }).parse(body);
      const { token } = await verifyPledger(db, b, cookies().get(DEVICE_COOKIE)?.value);
      cookies().set(DEVICE_COOKIE, token, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VERIFY_MINUTES * 60,
      });
      return NextResponse.json(await me(token));
    }
    case 'pledge-code': {
      const b = z.object({ token: z.string().min(10).max(64), locale: z.string().max(5).optional() }).parse(body);
      const r = await sendCodeForPledge(db, b.token, b.locale);
      // Only the masked number goes back: the visitor may not be the owner.
      return NextResponse.json({ channel: r.channel, phone: maskPhone(r.identifier), devCode: r.devCode });
    }
    case 'pledge-verify': {
      const b = z.object({ token: z.string().min(10).max(64), code: z.string().max(6) }).parse(body);
      const { token } = await verifyForPledge(db, b.token, b.code, cookies().get(DEVICE_COOKIE)?.value);
      cookies().set(DEVICE_COOKIE, token, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VERIFY_MINUTES * 60,
      });
      return NextResponse.json({ ok: true });
    }
    case 'forget': {
      const token = cookies().get(DEVICE_COOKIE)?.value;
      if (token) await forgetDevice(db, token);
      cookies().delete(DEVICE_COOKIE);
      return NextResponse.json({ ok: true });
    }
  }
  return jsonError('not_found', 404);
});
