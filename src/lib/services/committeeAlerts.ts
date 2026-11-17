import type { Db } from '../db';
import { APP_URL } from '../config';
import { notify } from '../notify';
import { formatMoney } from '../money';
import { makeT, type Locale } from '@/i18n';
import type { EventType } from '../eventTypes';

/**
 * WhatsApp (SMS fallback) alerts to the committee so money and role changes are never silent:
 *  - a withdrawal was requested  -> every treasurer and organizer except the person who asked
 *  - your role changed / you were removed -> that person
 *  - you are now the organizer   -> the new organizer
 * An alert that fails to send never blocks the action itself; it is logged in messages_log.
 */
async function send(db: Db, user: { phone: string | null; locale: string | null }, e: { id: string; type: string }, stage: 'payout_requested' | 'role_changed' | 'owner_changed', vars: Record<string, string>) {
  if (!user.phone) return;
  try {
    await notify(db, { to: user.phone, stage, eventType: e.type as EventType, locale: user.locale ?? 'en', vars, purpose: stage, eventId: e.id });
  } catch (err) {
    console.error('[alerts]', stage, (err as Error).message);
  }
}

export async function alertPayoutRequested(db: Db, payout: { event_id: string; amount: number | string; currency: string; requested_by: string }) {
  const [e] = await db.query('SELECT id, type, title FROM events WHERE id=$1', [payout.event_id]);
  const people = await db.query(
    `SELECT u.phone, u.locale FROM event_members m JOIN users u ON u.id=m.user_id
      WHERE m.event_id=$1 AND m.role IN ('treasurer','owner') AND m.user_id <> $2`,
    [payout.event_id, payout.requested_by],
  );
  for (const p of people) {
    await send(db, p, e, 'payout_requested', { amount: formatMoney(Number(payout.amount), payout.currency), event: e.title, link: `${APP_URL()}/app/e/${e.id}/payouts` });
  }
}

export async function alertRoleChanged(db: Db, eventId: string, userId: string, role: 'owner' | 'treasurer' | 'viewer' | 'removed') {
  const [e] = await db.query('SELECT id, type, title FROM events WHERE id=$1', [eventId]);
  const [u] = await db.query('SELECT phone, locale FROM users WHERE id=$1', [userId]);
  if (!e || !u) return;
  const t = makeT(((u.locale as Locale) ?? 'en'));
  const label = role === 'removed' ? t('alert.removed') : t(`role.${role}` as any);
  await send(db, u, e, 'role_changed', { event: e.title, role: label, link: `${APP_URL()}/app` });
}

export async function alertOwnerChanged(db: Db, eventId: string, newOwnerId: string) {
  const [e] = await db.query('SELECT id, type, title FROM events WHERE id=$1', [eventId]);
  const [u] = await db.query('SELECT phone, locale FROM users WHERE id=$1', [newOwnerId]);
  if (!e || !u) return;
  await send(db, u, e, 'owner_changed', { event: e.title, link: `${APP_URL()}/app/e/${e.id}` });
}
