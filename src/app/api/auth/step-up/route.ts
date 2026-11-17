import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { sendStepUpCode, verifyStepUp } from '@/lib/services/stepUp';
import { maskPhone } from '@/lib/phone';
import { api, apiUser, SESSION_COOKIE } from '@/lib/web';

const Body = z.object({ code: z.string().max(6).optional(), locale: z.string().max(5).optional() });

/** "Confirm it's you": first call sends a fresh code to the account's own phone (or email); second call checks it. */
export const POST = api(async (req) => {
  const user = await apiUser();
  const db = await getDb();
  const b = Body.parse(await req.json().catch(() => ({})));
  if (!b.code) {
    const r = await sendStepUpCode(db, user, b.locale);
    return NextResponse.json({ to: user.phone ? maskPhone(user.phone) : user.email, channel: r.channel, devCode: r.devCode });
  }
  await verifyStepUp(db, user, cookies().get(SESSION_COOKIE)?.value ?? '', b.code);
  return NextResponse.json({ ok: true });
});
