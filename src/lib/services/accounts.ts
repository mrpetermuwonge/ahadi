import type { Db } from '../db';
import { audit } from '../audit';
import { EventError } from './events';

/**
 * Account control for Ahadi staff (Admin → Accounts). Everyone can look (read-only for Support);
 * only super admins change accounts, after a fresh code. Rules: never your own account, and there is always
 * at least one active super admin. Every change is in the audit log.
 */
export type AccountKind = 'all' | 'organizers' | 'committee' | 'staff' | 'suspended';

export async function listAccounts(db: Db, opts: { q?: string; kind?: AccountKind; limit?: number }) {
  const q = (opts.q ?? '').trim();
  const digits = q.replace(/\D/g, '');
  const kind = opts.kind ?? 'all';
  return db.query(
    `SELECT u.id, u.name, u.phone, u.email, u.is_admin, u.admin_role, u.created_at, u.suspended_at,
            (SELECT COUNT(*) FROM event_members m WHERE m.user_id=u.id AND m.role='owner')::int AS owns,
            (SELECT COUNT(*) FROM event_members m WHERE m.user_id=u.id AND m.role<>'owner')::int AS committee,
            (SELECT MAX(created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login
       FROM users u
      WHERE ($1 = '' OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR ($2 <> '' AND u.phone LIKE '%' || $2 || '%') OR u.id = $1)
        AND ($3 = 'all'
             OR ($3 = 'organizers' AND EXISTS (SELECT 1 FROM event_members m WHERE m.user_id=u.id AND m.role='owner'))
             OR ($3 = 'committee' AND EXISTS (SELECT 1 FROM event_members m WHERE m.user_id=u.id AND m.role<>'owner'))
             OR ($3 = 'staff' AND u.is_admin)
             OR ($3 = 'suspended' AND u.suspended_at IS NOT NULL))
      ORDER BY u.suspended_at IS NULL, u.created_at DESC
      LIMIT $4`,
    [q, digits.length >= 6 ? digits.slice(-9) : '', kind, Math.min(500, opts.limit ?? 200)],
  );
}

export async function accountDetail(db: Db, userId: string) {
  const [user] = await db.query(
    `SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at > now())::int AS active_sessions,
            (SELECT MAX(created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login,
            sb.name AS suspended_by_name
       FROM users u LEFT JOIN users sb ON sb.id=u.suspended_by WHERE u.id=$1`,
    [userId],
  );
  if (!user) return null;
  const events = await db.query(
    `SELECT e.id, e.title, e.type, e.status, e.frozen, m.role FROM event_members m JOIN events e ON e.id=m.event_id
      WHERE m.user_id=$1 ORDER BY e.created_at DESC`,
    [userId],
  );
  const payoutAccounts = await db.query(`SELECT kind, label, phone, bank_name, account_no, verified FROM payout_accounts WHERE user_id=$1`, [userId]);
  const activity = await db.query(
    `SELECT action, entity_type, entity_id, created_at FROM audit_logs WHERE actor_user_id=$1 ORDER BY id DESC LIMIT 15`,
    [userId],
  );
  return { user, events, payoutAccounts, activity };
}

async function guard(db: Db, actor: string, userId: string) {
  if (actor === userId) throw new EventError('cannot_change_self');
  const [u] = await db.query('SELECT * FROM users WHERE id=$1', [userId]);
  if (!u) throw new EventError('not_found');
  return u;
}

/** Suspend: no login, all sessions end. Optionally freeze the events they organise (pledging and withdrawals pause). */
export async function suspendAccount(db: Db, actor: string, userId: string, reason: string, freezeEvents: boolean) {
  if (reason.trim().length < 10) throw new EventError('reason_required');
  const u = await guard(db, actor, userId);
  if (u.admin_role === 'super') {
    const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE admin_role='super' AND suspended_at IS NULL`);
    if (n <= 1) throw new EventError('last_super_admin');
  }
  await db.tx(async (q) => {
    await q.query(`UPDATE users SET suspended_at=now(), suspended_reason=$2, suspended_by=$3 WHERE id=$1`, [userId, reason.trim(), actor]);
    await q.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
    let frozen: string[] = [];
    if (freezeEvents) {
      const rows = await q.query(
        `UPDATE events SET frozen=true WHERE NOT frozen AND id IN (SELECT event_id FROM event_members WHERE user_id=$1 AND role='owner') RETURNING id`,
        [userId],
      );
      frozen = rows.map((r) => r.id);
    }
    await audit(q, { actor, action: 'admin.account_suspended', entityType: 'user', entityId: userId, details: { reason: reason.trim(), frozenEvents: frozen } });
  });
}

/** Reactivate a suspended account. Frozen events stay frozen until staff unfreeze them (Admin → Events). */
export async function reactivateAccount(db: Db, actor: string, userId: string) {
  const u = await guard(db, actor, userId);
  if (!u.suspended_at) return;
  await db.query(`UPDATE users SET suspended_at=NULL, suspended_reason=NULL, suspended_by=NULL WHERE id=$1`, [userId]);
  await audit(db, { actor, action: 'admin.account_reactivated', entityType: 'user', entityId: userId, details: { wasSuspendedFor: u.suspended_reason } });
}

/** End every session of an account (e.g. a lost phone): they must log in again with a fresh code. */
export async function signOutEverywhere(db: Db, actor: string, userId: string) {
  await guard(db, actor, userId);
  const rows = await db.query(`DELETE FROM sessions WHERE user_id=$1 RETURNING 1`, [userId]);
  await audit(db, { actor, action: 'admin.account_signed_out', entityType: 'user', entityId: userId, details: { sessions: rows.length } });
  return rows.length;
}

export async function renameAccount(db: Db, actor: string, userId: string, name: string) {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 2 || !/\p{L}/u.test(clean)) throw new EventError('invalid_name');
  const u = await guard(db, actor, userId);
  await db.query(`UPDATE users SET name=$2 WHERE id=$1`, [userId, clean]);
  await audit(db, { actor, action: 'admin.account_renamed', entityType: 'user', entityId: userId, details: { before: u.name ?? null, after: clean } });
}
