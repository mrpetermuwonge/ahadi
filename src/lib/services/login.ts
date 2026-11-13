import type { Db } from '../db';
import { consumeCode, isAdminIdentity, parseIdentifier, signInUser, type IdKind } from './auth';
import { openPledgerSession } from './pledgerAccess';

/**
 * One login for everyone. After the code, the number decides where the person lands:
 *   - runs events (any committee role) or is an admin → organizer dashboard (30-day sign-in)
 *   - has only pledged                                 → pledger portal (short verification, no account created)
 *   - brand new                                        → organizer sign-up ("create your first event")
 * `intent: 'organizer'` (e.g. "Start an event") always signs in as an organizer.
 */
export interface NumberRoles {
  runsEvents: boolean;
  isPledger: boolean;
  isAdmin: boolean;
}

export async function rolesForPhone(db: Db, phone: string): Promise<NumberRoles> {
  const [u] = await db.query(
    `SELECT u.is_admin, (SELECT COUNT(*) FROM event_members m WHERE m.user_id=u.id)::int AS events FROM users u WHERE u.phone=$1`,
    [phone],
  );
  const [p] = await db.query(`SELECT 1 AS yes FROM pledgers WHERE phone=$1 AND deleted_at IS NULL`, [phone]);
  return {
    runsEvents: Number(u?.events ?? 0) > 0,
    isPledger: !!p,
    isAdmin: !!u?.is_admin || isAdminIdentity(phone, null),
  };
}

export type LoginResult =
  | { portal: 'organizer'; sessionToken: string; redirect: string }
  | { portal: 'pledger'; pledgerToken: string; redirect: string };

export async function smartLogin(
  db: Db,
  a: { kind: IdKind; value: string; code: string; intent: 'auto' | 'organizer'; next?: string | null },
): Promise<LoginResult> {
  const identifier = parseIdentifier(a.kind, a.value);
  await consumeCode(db, identifier, a.code, 'login');
  if (a.kind === 'phone' && a.intent === 'auto') {
    const r = await rolesForPhone(db, identifier);
    if (!r.runsEvents && !r.isAdmin && r.isPledger) {
      return { portal: 'pledger', pledgerToken: await openPledgerSession(db, identifier), redirect: '/my' };
    }
  }
  const { token } = await signInUser(db, a.kind, identifier);
  return { portal: 'organizer', sessionToken: token, redirect: a.next ?? '/app' };
}
