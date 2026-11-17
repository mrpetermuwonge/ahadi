import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { APP_URL } from '@/lib/config';
import { SESSION_DAYS, signInUser } from '@/lib/services/auth';
import { rolesForPhone } from '@/lib/services/login';
import { DEVICE_COOKIE, devicePhone } from '@/lib/services/pledgerAccess';
import { SESSION_COOKIE, sameOrigin } from '@/lib/web';

/**
 * "Open my events dashboard" from the pledge form: the number was just proven with a code there,
 * so an organizer can go straight to their dashboard without a second code.
 * It signs in, so it is a POST from a button on our own pages (a link from another site can't trigger it).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = await getDb();
  const phone = await devicePhone(db, cookies().get(DEVICE_COOKIE)?.value);
  if (!phone) return NextResponse.redirect(`${APP_URL()}/login`, 303);
  const roles = await rolesForPhone(db, phone);
  if (!roles.runsEvents && !roles.isAdmin) return NextResponse.redirect(`${APP_URL()}/my`, 303);
  const { token } = await signInUser(db, 'phone', phone);
  const res = NextResponse.redirect(`${APP_URL()}/app`, 303);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAYS * 86400,
  });
  return res;
}

/** Old links and bookmarks: go to the login page. Nothing changes on a GET. */
export async function GET() {
  return NextResponse.redirect(`${APP_URL()}/login?next=/app`);
}

// Reads cookies and signs in: must never be pre-rendered at build time.
export const dynamic = 'force-dynamic';
