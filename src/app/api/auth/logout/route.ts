import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { logout } from '@/lib/services/auth';
import { api, SESSION_COOKIE } from '@/lib/web';

export const POST = api(async () => {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) await logout(await getDb(), token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
