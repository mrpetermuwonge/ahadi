import type { Db } from './db';

/** Append-only audit trail for every money action, manual entry, role change and admin override. */
export async function audit(
  db: Db,
  a: { actor: string | null; action: string; entityType: string; entityId: string; eventId?: string | null; details?: unknown },
) {
  await db.query(
    `INSERT INTO audit_logs(actor_user_id, action, entity_type, entity_id, event_id, details) VALUES ($1,$2,$3,$4,$5,$6)`,
    [a.actor, a.action, a.entityType, a.entityId, a.eventId ?? null, JSON.stringify(a.details ?? {})],
  );
}
