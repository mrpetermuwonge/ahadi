import type { Db } from '../db';
import { audit } from '../audit';
import { newId } from '../ids';
import { EventError } from './events';

/** Partners in the sliding strip on the homepage. Managed in Admin → Partners (Super admin, Trust & safety). */
export interface Partner { id: string; name: string; tagline: string | null; url: string | null; logo_file_id: string | null; sort: number; active: boolean; demo: boolean }

export const publicPartners = (db: Db) =>
  db.query<Partner>(`SELECT id, name, tagline, url, logo_file_id, sort, active, demo FROM partners WHERE active ORDER BY sort, created_at LIMIT 30`);

export const allPartners = (db: Db) =>
  db.query<Partner>(`SELECT id, name, tagline, url, logo_file_id, sort, active, demo FROM partners ORDER BY sort, created_at`);

function cleanUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  if (!u) return null;
  // Only real web links: no javascript: or data: links on the public homepage.
  if (!/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(u)) throw new EventError('invalid_url');
  return u.slice(0, 300);
}

export async function addPartner(db: Db, actor: string, p: { name: string; tagline?: string | null; url?: string | null; logoFileId?: string | null }) {
  const name = p.name.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60) throw new EventError('invalid_name');
  const url = cleanUrl(p.url);
  return db.tx(async (q) => {
    if (p.logoFileId) {
      const [f] = await q.query(`SELECT id FROM files WHERE id=$1 AND owner_user_id=$2 AND mime LIKE 'image/%'`, [p.logoFileId, actor]);
      if (!f) throw new EventError('invalid_input');
      await q.query(`UPDATE files SET is_public=true WHERE id=$1`, [p.logoFileId]);
    }
    const [{ next }] = await q.query<{ next: number }>(`SELECT COALESCE(MAX(sort),0)+1 AS next FROM partners`);
    const id = newId('ptn');
    await q.query(`INSERT INTO partners(id, name, tagline, url, logo_file_id, sort) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, name, (p.tagline ?? '').trim().slice(0, 60) || null, url, p.logoFileId ?? null, next]);
    await audit(q, { actor, action: 'admin.partner_added', entityType: 'partner', entityId: id, details: { name, url } });
    return id;
  });
}

export async function updatePartner(db: Db, actor: string, id: string, change: { active?: boolean; move?: 'up' | 'down'; logoFileId?: string | null }) {
  await db.tx(async (q) => {
    const [p] = await q.query(`SELECT * FROM partners WHERE id=$1 FOR UPDATE`, [id]);
    if (!p) throw new EventError('not_found');
    if (change.logoFileId !== undefined) {
      if (change.logoFileId) {
        const [f] = await q.query(`SELECT id FROM files WHERE id=$1 AND owner_user_id=$2 AND mime LIKE 'image/%'`, [change.logoFileId, actor]);
        if (!f) throw new EventError('invalid_input');
        await q.query(`UPDATE files SET is_public=true WHERE id=$1`, [change.logoFileId]);
      }
      await q.query(`UPDATE partners SET logo_file_id=$2 WHERE id=$1`, [id, change.logoFileId]);
    }
    if (change.active !== undefined) await q.query(`UPDATE partners SET active=$2 WHERE id=$1`, [id, change.active]);
    if (change.move) {
      const [other] = await q.query(
        change.move === 'up'
          ? `SELECT id, sort FROM partners WHERE sort < $1 ORDER BY sort DESC LIMIT 1`
          : `SELECT id, sort FROM partners WHERE sort > $1 ORDER BY sort ASC LIMIT 1`,
        [p.sort],
      );
      if (other) {
        await q.query(`UPDATE partners SET sort=$2 WHERE id=$1`, [id, other.sort]);
        await q.query(`UPDATE partners SET sort=$2 WHERE id=$1`, [other.id, p.sort]);
      }
    }
    await audit(q, { actor, action: 'admin.partner_updated', entityType: 'partner', entityId: id, details: change });
  });
}

export async function deletePartner(db: Db, actor: string, id: string) {
  const rows = await db.query(`DELETE FROM partners WHERE id=$1 RETURNING name`, [id]);
  if (!rows.length) throw new EventError('not_found');
  await audit(db, { actor, action: 'admin.partner_deleted', entityType: 'partner', entityId: id, details: { name: rows[0]!.name } });
}
