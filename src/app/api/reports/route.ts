import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/ids';
import { api, jsonError } from '@/lib/web';

/** Public "report this event" button. */
export const POST = api(async (req) => {
  const b = z.object({ eventId: z.string().max(40), reason: z.string().min(3).max(500) }).parse(await req.json());
  const db = await getDb();
  const [e] = await db.query('SELECT id FROM events WHERE id=$1', [b.eventId]);
  if (!e) return jsonError('not_found', 404);
  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM reports WHERE event_id=$1 AND created_at > now() - interval '1 hour'`, [e.id]);
  if (n < 20) await db.query(`INSERT INTO reports(id, event_id, source, reason) VALUES ($1,$2,'user',$3)`, [newId('rep'), e.id, b.reason]);
  return NextResponse.json({ ok: true });
});
