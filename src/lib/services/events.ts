import type { Db } from '../db';
import { APP_URL } from '../config';
import { audit } from '../audit';
import { EVENT_TYPES, ORGANIZER_KINDS, type EventType, type OrganizerKind } from '../eventTypes';
import { newId, slugify } from '../ids';
import { eventTotals, pledgeBalances, pledgeState, type PledgeState } from '../ledger';
import { notify } from '../notify';
import { normalizePhone } from '../phone';
import { getSettings } from '../settings';
import { localDate } from '../time';
import { hasRole, roleFor, type Role } from './auth';
import { can, permissionsFor, type Permission } from '../permissions';
import { alertOwnerChanged, alertRoleChanged } from './committeeAlerts';

export class EventError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface NewEvent {
  type: EventType;
  title: string;
  eventDate: string | null;
  targetAmount: number | null;
  story: string;
  coverFileId: string | null;
  details: Record<string, string>;
  urgent: boolean;
  organizerKind?: OrganizerKind;
  showOnHome?: boolean;
}

export async function createEvent(db: Db, userId: string, e: NewEvent) {
  const tpl = EVENT_TYPES[e.type];
  if (!tpl) throw new EventError('invalid_type');
  const title = e.title.trim();
  if (title.length < 3 || title.length > 100) throw new EventError('invalid_title');
  if (e.targetAmount !== null && (!Number.isSafeInteger(e.targetAmount) || e.targetAmount <= 0)) throw new EventError('invalid_amount');
  const kind = e.organizerKind ?? 'individual';
  if (!ORGANIZER_KINDS.includes(kind)) throw new EventError('invalid');
  const settings = await getSettings(db);
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM events e WHERE e.created_by=$1 AND e.status='active'
       AND NOT EXISTS (SELECT 1 FROM event_passes p WHERE p.event_id=e.id)`,
    [userId],
  );
  if (n >= settings.free_max_active_events) throw new EventError('free_limit');

  const details: Record<string, string> = {};
  for (const f of tpl.fields) if (e.details[f.key]) details[f.key] = String(e.details[f.key]).slice(0, 200);

  return db.tx(async (q) => {
    const id = newId('evt');
    const [row] = await q.query(
      `INSERT INTO events(id, slug, type, title, event_date, story, details, cover_file_id, target_amount, urgent, tips_enabled, created_by,
                          organizer_kind, show_on_home, home_requested_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [id, slugify(title), e.type, title, e.eventDate || null, e.story.slice(0, 4000), JSON.stringify(details), e.coverFileId,
       e.targetAmount, tpl.urgentAllowed && e.urgent, tpl.tipsDefault, userId, kind, !!e.showOnHome, e.showOnHome ? new Date().toISOString() : null],
    );
    await q.query(`INSERT INTO event_members(event_id, user_id, role, added_by) VALUES ($1,$2,'owner',$2)`, [id, userId]);
    if (e.coverFileId) await q.query('UPDATE files SET is_public=true WHERE id=$1 AND owner_user_id=$2', [e.coverFileId, userId]);
    await audit(q, { actor: userId, action: 'event.created', entityType: 'event', entityId: id, eventId: id, details: { type: e.type } });
    return row;
  });
}

/** Load an event for a signed-in user, enforcing the role on the server. Throws if not allowed. */
export async function eventForUser(db: Db, eventId: string, user: { id: string; is_admin: boolean }, needed: Role = 'viewer') {
  const role = await roleFor(db, eventId, user);
  if (!hasRole(role, needed)) throw new EventError('forbidden');
  const [e] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!e) throw new EventError('not_found');
  return { event: e, role: role! };
}

/**
 * Open an event for a signed-in user and check ONE permission from the role table (lib/permissions.ts).
 * Throws 'forbidden' when the role may not do it. Returns the role's full permission set for the interface.
 */
export async function eventAccess(db: Db, eventId: string, user: { id: string; is_admin: boolean }, perm: Permission) {
  const role = await roleFor(db, eventId, user);
  const [e] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!e || !role) throw new EventError(e ? 'forbidden' : 'not_found');
  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM event_members WHERE event_id=$1 AND role='treasurer'`, [eventId]);
  const ctx = { hasTreasurer: n > 0 };
  if (!can(role, perm, ctx)) throw new EventError('forbidden');
  return { event: e, role, ctx, perms: permissionsFor(role, ctx) };
}

export async function myEvents(db: Db, userId: string) {
  const rows = await db.query(
    `SELECT e.*, m.role FROM events e JOIN event_members m ON m.event_id=e.id WHERE m.user_id=$1 ORDER BY e.created_at DESC`,
    [userId],
  );
  return Promise.all(rows.map(async (e) => ({ ...e, totals: await eventTotals(db, e.id) })));
}

export interface PledgeRow {
  id: string;
  name: string;
  phone: string;
  anonymous: boolean;
  amount: number;
  paid: number;
  balance: number;
  state: PledgeState;
  dueDate: string | null;
  message: string | null;
  messageStatus: string;
  createdAt: string;
  /** Recorded by the committee: waiting for the pledger, confirmed, or "not my pledge". Null when they pledged themselves. */
  recorded: 'pending' | 'confirmed' | 'disputed' | null;
}

export async function pledgeRows(db: Db, eventId: string): Promise<PledgeRow[]> {
  const rows = await db.query(
    `SELECT p.*, pl.phone, pl.name AS pledger_name FROM pledges p JOIN pledgers pl ON pl.id=p.pledger_id WHERE p.event_id=$1 ORDER BY p.created_at DESC`,
    [eventId],
  );
  const bals = await pledgeBalances(db, eventId);
  const today = localDate();
  return rows.map((r) => {
    const b = bals.get(r.id) ?? { pledgeId: r.id, pledged: 0, paid: 0, balance: 0 };
    return {
      id: r.id,
      name: r.display_name,
      phone: r.phone,
      anonymous: r.anonymous,
      amount: b.pledged,
      paid: b.paid,
      balance: b.balance,
      state: pledgeState(b, r.due_date, today),
      dueDate: r.due_date,
      message: r.message,
      messageStatus: r.message_status,
      createdAt: new Date(r.created_at).toISOString(),
      recorded: r.source === 'self' ? null : r.disputed_at ? 'disputed' : r.confirmed_at ? 'confirmed' : 'pending',
    };
  });
}

export async function dailyActivity(db: Db, eventId: string, days = 14) {
  return db.query<{ day: string; pledged: number; collected: number }>(
    `SELECT to_char(j.created_at AT TIME ZONE 'Africa/Kampala', 'YYYY-MM-DD') AS day,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='pledge_income'),0))::bigint AS pledged,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected
       FROM ledger_journals j JOIN ledger_entries le ON le.journal_id=j.id
      WHERE j.event_id=$1 AND j.created_at > now() - ($2 || ' days')::interval
      GROUP BY 1 ORDER BY 1`,
    [eventId, String(days)],
  );
}

export async function publicEvent(db: Db, slug: string) {
  const [e] = await db.query(`SELECT * FROM events WHERE slug=$1`, [slug]);
  if (!e) return null;
  const totals = await eventTotals(db, e.id);
  const messages = await db.query(
    `SELECT CASE WHEN anonymous THEN NULL ELSE display_name END AS name, message FROM pledges
      WHERE event_id=$1 AND disputed_at IS NULL AND message IS NOT NULL AND message_status='approved' ORDER BY created_at DESC LIMIT 20`,
    [e.id],
  );
  const supporters =
    e.privacy === 'public_list'
      ? await db.query(`SELECT CASE WHEN anonymous THEN NULL ELSE display_name END AS name FROM pledges WHERE event_id=$1 AND disputed_at IS NULL ORDER BY created_at DESC LIMIT 50`, [e.id])
      : [];
  const [org] = await db.query(`SELECT u.name FROM users u WHERE u.id=$1`, [e.created_by]);
  return { event: e, totals, messages, supporters, organizerName: org?.name ?? null };
}

export async function addMember(db: Db, eventId: string, actor: string, rawPhone: string, role: Role) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new EventError('invalid_phone');
  // One organizer (owner) per event; the committee gets treasurers and helpers. This keeps it clear who is
  // accountable, and stops anyone giving away or losing control of the event by accident.
  if (!['treasurer', 'viewer'].includes(role)) throw new EventError('invalid_role');
  const [e] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  const r = await db.tx(async (q) => {
    let [u] = await q.query('SELECT * FROM users WHERE phone=$1', [phone]);
    if (!u) [u] = await q.query(`INSERT INTO users(id, phone) VALUES ($1,$2) RETURNING *`, [newId('usr'), phone]);
    if (u.id === actor) throw new EventError('cannot_change_self');
    const [cur] = await q.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2`, [eventId, u.id]);
    if (cur?.role === 'owner') throw new EventError('cannot_change_owner');
    await q.query(
      `INSERT INTO event_members(event_id, user_id, role, added_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (event_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
      [eventId, u.id, role, actor],
    );
    await audit(q, { actor, action: 'member.role_set', entityType: 'user', entityId: u.id, eventId, details: { role, before: cur?.role ?? null } });
    return { userId: u.id as string, before: (cur?.role ?? null) as string | null };
  });
  // New member: an invitation. Existing member whose role changed: a "your role is now" message.
  if (!r.before) {
    await notify(db, { to: phone, stage: 'invite', eventType: e.type, locale: 'en', purpose: 'invite', eventId, vars: { event: e.title, link: `${APP_URL()}/login` } });
  } else if (r.before !== role) {
    await alertRoleChanged(db, eventId, r.userId, role as 'treasurer' | 'viewer');
  }
}

export async function removeMember(db: Db, eventId: string, actor: string, userId: string) {
  if (userId === actor) throw new EventError('cannot_change_self');
  const [cur] = await db.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2`, [eventId, userId]);
  if (cur?.role === 'owner') throw new EventError('cannot_change_owner');
  const owners = await db.query(`SELECT user_id FROM event_members WHERE event_id=$1 AND role='owner'`, [eventId]);
  if (owners.length === 1 && owners[0].user_id === userId) throw new EventError('last_owner');
  await db.query('DELETE FROM event_members WHERE event_id=$1 AND user_id=$2', [eventId, userId]);
  await audit(db, { actor, action: 'member.removed', entityType: 'user', entityId: userId, eventId, details: { before: cur?.role ?? null } });
  if (cur) await alertRoleChanged(db, eventId, userId, 'removed');
}

/**
 * Ahadi staff (Super admin, Trust & safety) replace or remove an event's cover photo, e.g. an inappropriate or
 * misleading picture. The new picture must be the staff member's own upload. Recorded in the audit log.
 */
export async function adminSetEventCover(db: Db, eventId: string, adminId: string, fileId: string | null) {
  await db.tx(async (q) => {
    const [e] = await q.query('SELECT id, cover_file_id FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    if (!e) throw new EventError('not_found');
    if (fileId) {
      const [f] = await q.query(`SELECT id FROM files WHERE id=$1 AND owner_user_id=$2 AND mime LIKE 'image/%'`, [fileId, adminId]);
      if (!f) throw new EventError('invalid_input');
      await q.query('UPDATE files SET is_public=true WHERE id=$1', [fileId]);
    }
    await q.query('UPDATE events SET cover_file_id=$2 WHERE id=$1', [eventId, fileId]);
    await audit(q, { actor: adminId, action: 'admin.event_cover', entityType: 'event', entityId: eventId, eventId, details: { before: e.cover_file_id, after: fileId } });
  });
}

/** Withdrawals that are not finished yet. Ownership can't change while one is in progress. */
async function assertNoOpenPayouts(q: Db, eventId: string) {
  const open = await q.query(
    `SELECT 1 FROM payouts WHERE event_id=$1 AND status IN ('awaiting_second_approval','in_review','processing') LIMIT 1`,
    [eventId],
  );
  if (open.length) throw new EventError('payout_in_progress');
}

/**
 * The organizer hands the event over to someone already on its committee (e.g. the treasurer takes over).
 * The old organizer stays on as a helper. Not allowed while a withdrawal is in progress, because withdrawals
 * go to the organizer's own mobile money number.
 */
export async function transferOwnership(db: Db, eventId: string, actor: string, newOwnerId: string) {
  if (newOwnerId === actor) throw new EventError('cannot_change_self');
  await db.tx(async (q) => {
    const [me] = await q.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2 FOR UPDATE`, [eventId, actor]);
    if (me?.role !== 'owner') throw new EventError('forbidden');
    const [them] = await q.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2 FOR UPDATE`, [eventId, newOwnerId]);
    if (!them) throw new EventError('not_a_member');
    await assertNoOpenPayouts(q, eventId);
    await q.query(`UPDATE event_members SET role='owner' WHERE event_id=$1 AND user_id=$2`, [eventId, newOwnerId]);
    await q.query(`UPDATE event_members SET role='viewer' WHERE event_id=$1 AND user_id=$2`, [eventId, actor]);
    await q.query(`UPDATE events SET created_by=$2 WHERE id=$1`, [eventId, newOwnerId]);
    await audit(q, { actor, action: 'event.ownership_transferred', entityType: 'event', entityId: eventId, eventId, details: { from: actor, to: newOwnerId, newRoleOfPrevious: 'viewer' } });
  });
  await alertOwnerChanged(db, eventId, newOwnerId);
  await alertRoleChanged(db, eventId, actor, 'viewer');
}

/**
 * Account recovery by Ahadi (super admin): the organizer lost their phone number, so a new number becomes the
 * organizer after Ahadi has checked their identity outside the app. The old number is removed from the committee.
 * The reason is required and kept in the audit log.
 */
export async function adminReassignOwner(db: Db, eventId: string, adminId: string, rawPhone: string, reason: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new EventError('invalid_phone');
  if (reason.trim().length < 10) throw new EventError('reason_required');
  const newOwnerId = await db.tx(async (q) => {
    const [e] = await q.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [eventId]);
    if (!e) throw new EventError('not_found');
    let [u] = await q.query('SELECT * FROM users WHERE phone=$1', [phone]);
    // Conflict of interest: staff can't hand an event (and its money) to themselves.
    if (u?.id === adminId) throw new EventError('conflict_of_interest');
    await assertNoOpenPayouts(q, eventId);
    if (!u) [u] = await q.query(`INSERT INTO users(id, phone) VALUES ($1,$2) RETURNING *`, [newId('usr'), phone]);
    const old = await q.query(`SELECT user_id FROM event_members WHERE event_id=$1 AND role='owner'`, [eventId]);
    await q.query(`DELETE FROM event_members WHERE event_id=$1 AND role='owner' AND user_id <> $2`, [eventId, u.id]);
    await q.query(
      `INSERT INTO event_members(event_id, user_id, role, added_by) VALUES ($1,$2,'owner',$3)
       ON CONFLICT (event_id, user_id) DO UPDATE SET role='owner'`,
      [eventId, u.id, adminId],
    );
    await q.query(`UPDATE events SET created_by=$2 WHERE id=$1`, [eventId, u.id]);
    // The new number is proven only when its owner logs in with a code, which also makes it a payout destination.
    await audit(q, { actor: adminId, action: 'admin.owner_reassigned', entityType: 'event', entityId: eventId, eventId,
      details: { to: u.id, toPhone: phone, removedOwners: old.map((o) => o.user_id), reason: reason.trim() } });
    return u.id as string;
  });
  await alertOwnerChanged(db, eventId, newOwnerId);
}

export async function updateEventSettings(
  db: Db,
  eventId: string,
  actor: string,
  s: { privacy?: string; reminderOffsets?: number[]; status?: string; tipsEnabled?: boolean; showOnHome?: boolean; organizerKind?: string; showAmounts?: boolean },
) {
  if (s.organizerKind && !(ORGANIZER_KINDS as readonly string[]).includes(s.organizerKind)) throw new EventError('invalid');
  if (s.privacy && !['hidden_list', 'public_list'].includes(s.privacy)) throw new EventError('invalid');
  if (s.status && !['active', 'closed'].includes(s.status)) throw new EventError('invalid');
  const offsets = s.reminderOffsets?.filter((n) => Number.isInteger(n) && n >= -30 && n <= 60).slice(0, 6);
  await db.query(
    `UPDATE events SET privacy=COALESCE($2,privacy), reminder_offsets=COALESCE($3,reminder_offsets), status=COALESCE($4,status),
            tips_enabled=COALESCE($5,tips_enabled) WHERE id=$1`,
    [eventId, s.privacy ?? null, offsets ?? null, s.status ?? null, s.tipsEnabled ?? null],
  );
  if (s.organizerKind) await db.query('UPDATE events SET organizer_kind=$2 WHERE id=$1', [eventId, s.organizerKind]);
  if (s.showAmounts !== undefined) await db.query('UPDATE events SET show_amounts=$2 WHERE id=$1', [eventId, s.showAmounts]);
  if (s.showOnHome !== undefined) {
    // Asking again after a decline puts the event back in the review queue.
    await db.query(
      `UPDATE events SET show_on_home=$2,
              home_requested_at=CASE WHEN $2 AND NOT show_on_home THEN now() ELSE home_requested_at END,
              home_approved=CASE WHEN $2 AND NOT show_on_home AND home_approved = false THEN NULL ELSE home_approved END
        WHERE id=$1`,
      [eventId, s.showOnHome],
    );
  }
  await audit(db, { actor, action: 'event.settings', entityType: 'event', entityId: eventId, eventId, details: s });
}

export interface EventDetailsInput {
  title: string;
  eventDate: string | null;
  targetAmount: number | null;
  story: string;
  coverFileId: string | null;
  details: Record<string, string>;
}

/**
 * Edit what people see on the event page (owner only). The link (slug) never changes, so shared links,
 * QR codes and pledge cards keep working. The before/after values go to the audit log, which matters most
 * for verified hospital/funeral events: an admin can see exactly what changed after verification.
 */
export async function updateEventDetails(db: Db, eventId: string, actor: string, d: EventDetailsInput) {
  const [e] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!e) throw new EventError('not_found');
  const tpl = EVENT_TYPES[e.type as EventType];
  const title = d.title.trim();
  if (title.length < 3 || title.length > 100) throw new EventError('invalid_title');
  if (d.targetAmount !== null && (!Number.isSafeInteger(d.targetAmount) || d.targetAmount <= 0)) throw new EventError('invalid_amount');
  const details: Record<string, string> = {};
  for (const f of tpl.fields) {
    const v = String(d.details[f.key] ?? '').trim().slice(0, 200);
    if (v) details[f.key] = v;
  }
  return db.tx(async (q) => {
    // A new cover must be the actor's own upload; it then becomes public like any cover.
    let cover = e.cover_file_id as string | null;
    if (d.coverFileId && d.coverFileId !== cover) {
      const [f] = await q.query(`SELECT id FROM files WHERE id=$1 AND owner_user_id=$2 AND mime LIKE 'image/%'`, [d.coverFileId, actor]);
      if (!f) throw new EventError('invalid_input');
      await q.query('UPDATE files SET is_public=true WHERE id=$1', [d.coverFileId]);
      cover = d.coverFileId;
    }
    const [row] = await q.query(
      `UPDATE events SET title=$2, event_date=$3, target_amount=$4, story=$5, cover_file_id=$6, details=$7 WHERE id=$1 RETURNING *`,
      [eventId, title, d.eventDate || null, d.targetAmount, d.story.slice(0, 4000), cover, JSON.stringify(details)],
    );
    const before = { title: e.title, eventDate: e.event_date, targetAmount: e.target_amount, story: e.story, cover: e.cover_file_id, details: e.details };
    const after = { title, eventDate: d.eventDate || null, targetAmount: d.targetAmount, story: d.story.slice(0, 4000), cover, details };
    await audit(q, { actor, action: 'event.details', entityType: 'event', entityId: eventId, eventId, details: { before, after, wasVerified: !!e.verified } });
    return row;
  });
}

export type HomeStatus = 'off' | 'pending' | 'live' | 'declined';
export function homeStatus(e: { show_on_home: boolean; home_approved: boolean | null }, requiresApproval: boolean): HomeStatus {
  if (!e.show_on_home) return 'off';
  if (e.home_approved === false) return 'declined';
  if (e.home_approved === true || !requiresApproval) return 'live';
  return 'pending';
}

export interface FeaturedEvent {
  slug: string;
  title: string;
  type: EventType;
  organizerKind: OrganizerKind;
  coverFileId: string | null;
  eventDate: string | null;
  pledgeCount: number;
  verified: boolean;
  urgent: boolean;
}

/**
 * Events for the homepage slideshow: the owner opted in, Ahadi approved (unless review is off), still open.
 * Only public information is returned: title, photo, type, date and number of supporters.
 * No money amounts (raised or target): those stay on the event page. Never names, phones or messages.
 */
export async function featuredEvents(db: Db): Promise<FeaturedEvent[]> {
  const s = await getSettings(db);
  const rows = await db.query(
    `SELECT * FROM events WHERE show_on_home AND status='active' AND NOT frozen
        AND (home_approved = true OR ($1 = false AND home_approved IS NULL))
      ORDER BY urgent DESC, verified DESC, home_requested_at DESC LIMIT $2`,
    [s.home_requires_approval, s.home_max_events],
  );
  return Promise.all(rows.map(async (e) => {
    const t = await eventTotals(db, e.id);
    return {
      slug: e.slug, title: e.title, type: e.type, organizerKind: e.organizer_kind, coverFileId: e.cover_file_id,
      eventDate: e.event_date ? localDate(new Date(e.event_date)) : null,
      pledgeCount: t.pledgeCount, verified: e.verified, urgent: e.urgent,
    };
  }));
}
