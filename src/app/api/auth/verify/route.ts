import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { SESSION_DAYS } from '@/lib/services/auth';
import { smartLogin } from '@/lib/services/login';
import { DEVICE_COOKIE, VERIFY_MINUTES } from '@/lib/services/pledgerAccess';
import { api, SESSION_COOKIE } from '@/lib/web';

const Body = z.object({
  kind: z.enum(['phone', 'email']),
  value: z.string().max(254),
  code: z.string().max(6),
  intent: z.enum(['auto', 'organizer']).optional(),
  next: z.string().max(200).regex(/^\/(?!\/)/).nullable().optional(),
});

/** Check the login code and send the person to the right portal (organizer dashboard or pledger portal). */
export const POST = api(async (req) => {
  const b = Body.parse(await req.json());
  const r = await smartLogin(await getDb(), { kind: b.kind, value: b.value, code: b.code, intent: b.intent ?? 'auto', next: b.next ?? null });
  const res = NextResponse.json({ ok: true, portal: r.portal, redirect: r.redirect });
  const secure = process.env.NODE_ENV === 'production';
  if (r.portal === 'organizer') {
    res.cookies.set(SESSION_COOKIE, r.sessionToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_DAYS * 86400 });
  } else {
    res.cookies.set(DEVICE_COOKIE, r.pledgerToken, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: VERIFY_MINUTES * 60 });
  }
  return res;
});
