import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { googleCallback } from '@/lib/services/google';
import { AuthError, loginWithGoogleProfile, SESSION_DAYS } from '@/lib/services/auth';
import { APP_URL } from '@/lib/config';
import { SESSION_COOKIE } from '@/lib/web';

/** Google sends the browser back here. On success we set the session cookie and continue to `next`. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('error')) return NextResponse.redirect(`${APP_URL()}/login?error=google_cancelled`);
  try {
    const db = await getDb();
    const { next, profile } = await googleCallback(db, url.searchParams.get('state'), url.searchParams.get('code'));
    const { token } = await loginWithGoogleProfile(db, profile);
    const res = NextResponse.redirect(`${APP_URL()}${next}`);
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    });
    return res;
  } catch (e) {
    const code = e instanceof AuthError ? e.code : 'google_failed';
    if (!(e instanceof AuthError)) console.error('google login', e);
    return NextResponse.redirect(`${APP_URL()}/login?error=${code}`);
  }
}
