import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { addPhoneToUser, requestCode } from '@/lib/services/auth';
import { api, apiUser } from '@/lib/web';

const Body = z.object({ phone: z.string().max(30), code: z.string().max(6).optional(), locale: z.string().max(5).optional() });

/** Signed-in user adds a phone: first call sends a WhatsApp code, second call (with code) verifies and saves it. */
export const POST = api(async (req) => {
  const user = await apiUser();
  const b = Body.parse(await req.json());
  const db = await getDb();
  if (!b.code) return NextResponse.json(await requestCode(db, { kind: 'phone', value: b.phone, locale: b.locale, purpose: 'add_phone' }));
  await addPhoneToUser(db, user.id, b.phone, b.code);
  return NextResponse.json({ ok: true });
});
