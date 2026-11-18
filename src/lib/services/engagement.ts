import type { Db } from '../db';
import { APP_URL } from '../config';
import { audit } from '../audit';
import type { EventType } from '../eventTypes';
import { newId } from '../ids';
import { formatMoney } from '../money';
import { notify } from '../notify';
import { getSettings } from '../settings';
import { inQuietHours } from '../time';
import { EventError } from './events';

/**
 * Committee tools to keep supporters engaged:
 *  - "Remind everyone who still owes": one WhatsApp/SMS to every pledger with a balance (at most once a day,
 *    never during quiet hours at night).
 *  - Updates: the organizer posts news (text and an optional picture) on the event page; optionally every
 *    pledger gets a short WhatsApp/SMS with the link (at most once a day, so it never becomes spam).
 */
const NUDGE_GAP_HOURS = 20;
const UPDATE_NOTIFY_GAP_HOURS = 20;

/** Pledgers who still owe on this event (not erased, not "not my pledge"). */
async function owing(db: Db, eventId: string) {
  return db.query(
    `SELECT p.id, p.access_token, p.display_name, pl.phone, pl.locale, x.bal
       FROM pledges p JOIN pledgers pl ON pl.id=p.pledger_id
       JOIN (SELECT pledge_id, SUM(amount) AS bal FROM ledger_entries WHERE event_id=$1 AND account='receivable' GROUP BY pledge_id) x ON x.pledge_id=p.id
      WHERE p.event_id=$1 AND x.bal > 0 AND p.disputed_at IS NULL AND pl.deleted_at IS NULL AND pl.phone LIKE '+%'`,
    [eventId],
  );
}

export async function owingSummary(db: Db, eventId: string) {
  const rows = await owing(db, eventId);
  const [e] = await db.query<{ last: string | null }>(`SELECT last_nudged_at AS last FROM events WHERE id=$1`, [eventId]);
  const last = e?.last ? new Date(e.last) : null;
  const nextAt = last ? new Date(last.getTime() + NUDGE_GAP_HOURS * 3600_000) : null;
  return { count: rows.length, total: rows.reduce((s, r) => s + Number(r.bal), 0), lastAt: last?.toISOString() ?? null, nextAt: nextAt && nextAt > new Date() ? nextAt.toISOString() : null };
}

export async function remindOwing(db: Db, eventId: string, actor: string) {
  const s = await getSettings(db);
  if (inQuietHours(new Date(), s.quiet_hours_start, s.quiet_hours_end)) throw new EventError('quiet_hours');
  // Claim the slot first so two clicks (or two committee members) can't both send.
  const claimed = await db.query(
    `UPDATE events SET last_nudged_at=now() WHERE id=$1 AND status='active' AND NOT frozen
        AND (last_nudged_at IS NULL OR last_nudged_at < now() - interval '${NUDGE_GAP_HOURS} hours') RETURNING id, title, type, currency, slug`,
    [eventId],
  );
  if (!claimed[0]) throw new EventError('nudge_too_soon');
  const e = claimed[0];
  const rows = await owing(db, eventId);
  let sent = 0;
  for (const r of rows) {
    const res = await notify(db, {
      to: r.phone, stage: 'nudge', eventType: e.type as EventType, locale: r.locale ?? 'en', purpose: 'nudge', eventId,
      vars: { name: String(r.display_name).split(' ')[0] ?? '', balance: formatMoney(Number(r.bal), e.currency), event: e.title, link: `${APP_URL()}/p/${r.access_token}` },
    }).catch(() => ({ ok: false }));
    if (res.ok) sent++;
  }
  await audit(db, { actor, action: 'pledgers.reminded', entityType: 'event', entityId: eventId, eventId, details: { owing: rows.length, sent } });
  return { owing: rows.length, sent };
}

export async function listUpdates(db: Db, eventId: string, includeHidden = false) {
  return db.query(
    `SELECT u.id, u.body, u.image_file_id, u.notified, u.created_at, u.hidden_at, COALESCE(a.name, 'Organizer') AS author
       FROM event_updates u LEFT JOIN users a ON a.id=u.author_id
      WHERE u.event_id=$1 AND ($2 OR u.hidden_at IS NULL) ORDER BY u.created_at DESC LIMIT 50`,
    [eventId, includeHidden],
  );
}

export async function postUpdate(db: Db, eventId: string, actor: string, input: { body: string; imageFileId: string | null; notifyPledgers: boolean }) {
  const body = input.body.trim().replace(/\n{3,}/g, '\n\n');
  if (body.length < 3 || body.length > 1500) throw new EventError('invalid_update');
  const [e] = await db.query(`SELECT * FROM events WHERE id=$1`, [eventId]);
  if (!e) throw new EventError('not_found');
  if (input.imageFileId) {
    const [f] = await db.query(`SELECT id FROM files WHERE id=$1 AND owner_user_id=$2 AND mime LIKE 'image/%'`, [input.imageFileId, actor]);
    if (!f) throw new EventError('invalid_input');
    await db.query(`UPDATE files SET is_public=true WHERE id=$1`, [input.imageFileId]);
  }
  const id = newId('upd');
  await db.query(`INSERT INTO event_updates(id, event_id, author_id, body, image_file_id) VALUES ($1,$2,$3,$4,$5)`, [id, eventId, actor, body, input.imageFileId]);
  let notified = 0;
  let notifySkipped = false;
  if (input.notifyPledgers) {
    const [recent] = await db.query(
      `SELECT 1 FROM event_updates WHERE event_id=$1 AND id<>$2 AND notified > 0 AND created_at > now() - interval '${UPDATE_NOTIFY_GAP_HOURS} hours'`, [eventId, id]);
    const s = await getSettings(db);
    if (recent || inQuietHours(new Date(), s.quiet_hours_start, s.quiet_hours_end)) notifySkipped = true;
    else {
      const people = await db.query(
        `SELECT DISTINCT pl.phone, pl.locale FROM pledges p JOIN pledgers pl ON pl.id=p.pledger_id
          WHERE p.event_id=$1 AND p.disputed_at IS NULL AND pl.deleted_at IS NULL AND pl.phone LIKE '+%'`, [eventId]);
      for (const pp of people) {
        const r = await notify(db, { to: pp.phone, stage: 'update', eventType: e.type as EventType, locale: pp.locale ?? 'en', purpose: 'update', eventId, vars: { event: e.title, link: `${APP_URL()}/e/${e.slug}#updates` } }).catch(() => ({ ok: false }));
        if (r.ok) notified++;
      }
      await db.query(`UPDATE event_updates SET notified=$2 WHERE id=$1`, [id, notified]);
    }
  }
  await audit(db, { actor, action: 'event.update_posted', entityType: 'event_update', entityId: id, eventId, details: { notified, notifySkipped } });
  return { id, notified, notifySkipped };
}

/** The organizer removes their update, or Ahadi staff hide an inappropriate one. Kept for the audit trail. */
export async function hideUpdate(db: Db, eventId: string, updateId: string, actor: string, byStaff: boolean) {
  const rows = await db.query(`UPDATE event_updates SET hidden_at=now(), hidden_by=$3 WHERE id=$1 AND event_id=$2 AND hidden_at IS NULL RETURNING id`, [updateId, eventId, actor]);
  if (!rows[0]) throw new EventError('not_found');
  await audit(db, { actor, action: byStaff ? 'admin.update_hidden' : 'event.update_removed', entityType: 'event_update', entityId: updateId, eventId });
}
