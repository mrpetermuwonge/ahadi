import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { APP_URL } from '@/lib/config';
import { currentUser, sameOrigin } from '@/lib/web';
import { DEVICE_COOKIE, VERIFY_MINUTES, openPledgerSession } from '@/lib/services/pledgerAccess';

/**
 * "My pledges" from the organizer dashboard: a signed-in organizer has proven their phone at login,
 * so open their pledger portal for that number (short verification, like any portal visit).
 * It changes cookies, so it is a POST from a button on our own pages (a link from another site can't trigger it).
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${APP_URL()}/login`, 303);
  if (!user.phone) return NextResponse.redirect(`${APP_URL()}/my`, 303); // email-only account: verify a number there
  const token = await openPledgerSession(await getDb(), user.phone, cookies().get(DEVICE_COOKIE)?.value);
  const res = NextResponse.redirect(`${APP_URL()}/my`, 303);
  res.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VERIFY_MINUTES * 60,
  });
  return res;
}

/** Old links and bookmarks: just open My pledges, which asks for a code. Nothing changes on a GET. */
export async function GET() {
  return NextResponse.redirect(`${APP_URL()}/my`);
}

// Reads cookies and signs in: must never be pre-rendered at build time.
export const dynamic = 'force-dynamic';
