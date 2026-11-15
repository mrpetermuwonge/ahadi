import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { api, apiUser, jsonError } from '@/lib/web';

const Body = z.object({ name: z.string().max(60) });

/** Save the signed-in user's display name (shown on their badge and as "Organised by" on pledge cards). */
export const POST = api(async (req) => {
  const user = await apiUser();
  const name = Body.parse(await req.json()).name.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || !/\p{L}/u.test(name)) return jsonError('invalid_name');
  const db = await getDb();
  await db.query('UPDATE users SET name=$2 WHERE id=$1', [user.id, name]);
  await audit(db, { actor: user.id, action: 'user.name', entityType: 'user', entityId: user.id, details: { before: user.name ?? null, after: name } });
  return NextResponse.json({ ok: true });
});
