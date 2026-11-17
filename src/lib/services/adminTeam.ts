import type { Db } from '../db';
import { audit } from '../audit';
import { newId } from '../ids';
import { normalizePhone } from '../phone';
import { getSettings, saveSetting, DEFAULT_SETTINGS, type SettingKey } from '../settings';
import { ADMIN_ROLES, MONEY_SETTINGS, type AdminRole } from '../adminPermissions';
import { EventError } from './events';

/**
 * Ahadi staff management (super admins only) and the two-person rule for money settings.
 * Rules: nobody changes their own admin role; there is always at least one super admin; every change is audited.
 */
export async function setAdminRole(db: Db, actor: string, rawPhone: string, role: AdminRole | null) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new EventError('invalid_phone');
  if (role && !ADMIN_ROLES.includes(role)) throw new EventError('invalid_role');
  return db.tx(async (q) => {
    let [u] = await q.query('SELECT * FROM users WHERE phone=$1', [phone]);
    if (!u) {
      if (!role) throw new EventError('not_found');
      [u] = await q.query(`INSERT INTO users(id, phone) VALUES ($1,$2) RETURNING *`, [newId('usr'), phone]);
    }
    if (u.id === actor) throw new EventError('cannot_change_self');
    if (u.admin_role === 'super' && role !== 'super') {
      const [{ n }] = await q.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE admin_role='super'`);
      if (n <= 1) throw new EventError('last_super_admin');
    }
    await q.query(`UPDATE users SET is_admin=$2, admin_role=$3 WHERE id=$1`, [u.id, !!role, role]);
    // A role change takes effect at once: their current sessions end, so they log in again with the new rights.
    await q.query(`DELETE FROM sessions WHERE user_id=$1`, [u.id]);
    await audit(q, { actor, action: role ? 'admin.role_set' : 'admin.role_removed', entityType: 'user', entityId: u.id, details: { phone, before: u.admin_role ?? null, after: role } });
    return u.id as string;
  });
}

export async function listAdmins(db: Db) {
  return db.query(
    `SELECT u.id, u.phone, u.email, u.name, u.admin_role, u.created_at,
            (SELECT MAX(created_at) FROM sessions s WHERE s.user_id=u.id) AS last_login
       FROM users u WHERE u.is_admin ORDER BY CASE u.admin_role WHEN 'super' THEN 0 WHEN 'finance' THEN 1 WHEN 'trust' THEN 2 ELSE 3 END, u.created_at`,
  );
}

/**
 * Save global settings. Ordinary settings apply at once. Money settings (fees, prices, limits) need a second
 * super admin to approve, unless this is the only super admin (then they apply, after the step-up code).
 */
export async function changeSettings(db: Db, actor: string, values: Record<string, unknown>) {
  const current = (await getSettings(db)) as unknown as Record<string, unknown>;
  const [{ n: supers }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE admin_role='super'`);
  const applied: string[] = [];
  const proposed: string[] = [];
  for (const [k, val] of Object.entries(values)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    if (JSON.stringify(current[k]) === JSON.stringify(val)) continue;
    if (MONEY_SETTINGS.includes(k) && supers > 1) {
      await db.query(
        `INSERT INTO setting_proposals(id, key, value, old_value, proposed_by) VALUES ($1,$2,$3,$4,$5)`,
        [newId('sp'), k, JSON.stringify(val), JSON.stringify(current[k] ?? null), actor],
      );
      proposed.push(k);
    } else {
      try {
        await saveSetting(db, k as SettingKey, val, actor);
      } catch {
        throw new EventError('invalid_input');
      }
      applied.push(k);
    }
  }
  await audit(db, { actor, action: 'admin.settings', entityType: 'settings', entityId: 'global', details: { applied, proposed, values } });
  return { applied, proposed };
}

export async function decideProposal(db: Db, actor: string, proposalId: string, approve: boolean) {
  await db.tx(async (q) => {
    const [p] = await q.query(`SELECT * FROM setting_proposals WHERE id=$1 FOR UPDATE`, [proposalId]);
    if (!p || p.status !== 'pending') throw new EventError('not_found');
    if (p.proposed_by === actor) throw new EventError('same_person');
    await q.query(`UPDATE setting_proposals SET status=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [proposalId, approve ? 'approved' : 'rejected', actor]);
    if (approve) await saveSetting(q, p.key as SettingKey, p.value, actor);
    await audit(q, { actor, action: approve ? 'admin.setting_approved' : 'admin.setting_rejected', entityType: 'setting', entityId: p.key, details: { value: p.value, old: p.old_value, proposedBy: p.proposed_by } });
  });
}
