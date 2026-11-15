import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { APP_URL } from '@/lib/config';
import { currentUser } from '@/lib/web';
import { DEVICE_COOKIE, VERIFY_MINUTES, openPledgerSession } from '@/lib/services/pledgerAccess';

/**
 * "My pledges" from the organizer dashboard: a signed-in organizer has proven their phone at login,
 * so open their pledger portal for that number (short verification, like any portal visit).
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${APP_URL()}/login`);
  if (!user.phone) return NextResponse.redirect(`${APP_URL()}/my`); // email-only account: verify a number there
  const token = await openPledgerSession(await getDb(), user.phone, cookies().get(DEVICE_COOKIE)?.value);
  const res = NextResponse.redirect(`${APP_URL()}/my`);
  res.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VERIFY_MINUTES * 60,
  });
  return res;
}

// Reads cookies and signs in: must never be pre-rendered at build time.
export const dynamic = 'force-dynamic';
