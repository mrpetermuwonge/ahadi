import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { requestCode } from '@/lib/services/auth';
import { api } from '@/lib/web';

const Body = z.object({ kind: z.enum(['phone', 'email']), value: z.string().max(254), locale: z.string().max(5).optional() });

/** Send a login code: phone → WhatsApp (SMS fallback), email → email. */
export const POST = api(async (req) => {
  const b = Body.parse(await req.json());
  const r = await requestCode(await getDb(), { kind: b.kind, value: b.value, locale: b.locale });
  return NextResponse.json(r);
});
