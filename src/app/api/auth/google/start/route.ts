import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { googleAuthUrl } from '@/lib/services/google';
import { APP_URL } from '@/lib/config';

export async function GET(req: Request) {
  try {
    const next = new URL(req.url).searchParams.get('next');
    return NextResponse.redirect(await googleAuthUrl(await getDb(), next));
  } catch {
    return NextResponse.redirect(`${APP_URL()}/login?error=google_disabled`);
  }
}
