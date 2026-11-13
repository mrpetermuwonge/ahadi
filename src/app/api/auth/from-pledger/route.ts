import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { APP_URL } from '@/lib/config';
import { SESSION_DAYS, signInUser } from '@/lib/services/auth';
import { rolesForPhone } from '@/lib/services/login';
import { DEVICE_COOKIE, devicePhone } from '@/lib/services/pledgerAccess';
import { SESSION_COOKIE } from '@/lib/web';

/**
 * "Open my events dashboard" from the pledge form: the number was just proven with a code there,
 * so an organizer can go straight to their dashboard without a second code.
 */
export async function GET() {
  const db = await getDb();
  const phone = await devicePhone(db, cookies().get(DEVICE_COOKIE)?.value);
  if (!phone) return NextResponse.redirect(`${APP_URL()}/login`);
  const roles = await rolesForPhone(db, phone);
  if (!roles.runsEvents && !roles.isAdmin) return NextResponse.redirect(`${APP_URL()}/my`);
  const { token } = await signInUser(db, 'phone', phone);
  const res = NextResponse.redirect(`${APP_URL()}/app`);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAYS * 86400,
  });
  return res;
}
