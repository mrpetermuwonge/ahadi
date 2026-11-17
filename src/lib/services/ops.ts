import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db';
import { newId } from '../ids';
import { RETENTION } from '../privacy';

/** Remember each backup / clean-up run so the Admin panel (and an auditor) can see they happen. */
async function record(db: Db, kind: string, ok: boolean, details: Record<string, unknown>) {
  await db.query(`INSERT INTO ops_runs(id, kind, ok, details) VALUES ($1,$2,$3,$4)`, [newId('ops'), kind, ok, JSON.stringify(details)]);
}

/**
 * Daily data clean-up (Uganda Data Protection and Privacy Act: keep personal data no longer than needed).
 * Removes or blanks short-lived operational data. Never touches money records, receipts or the audit log.
 */
export async function runRetention(db: Db) {
  const n = async (sql: string) => (await db.query(`${sql} RETURNING 1`)).length;
  const r = {
    otpCodes: await n(`DELETE FROM otp_codes WHERE created_at < now() - interval '${RETENTION.otpCodesDays} days'`),
    sessions: await n(`DELETE FROM sessions WHERE expires_at < now() - interval '${RETENTION.expiredSessionsDays} days'`),
    pledgerVisits: await n(`DELETE FROM pledger_devices WHERE expires_at < now() - interval '${RETENTION.pledgerVisitsDays} days'`),
    oauthStates: await n(`DELETE FROM oauth_states WHERE expires_at < now() - interval '${RETENTION.oauthStatesDays} days'`),
    messageBodies: await n(`UPDATE messages_log SET body='[removed after ${RETENTION.messageBodiesDays} days]'
                             WHERE created_at < now() - interval '${RETENTION.messageBodiesDays} days' AND body NOT LIKE '[removed%'`),
    webhookPayloads: await n(`UPDATE webhook_events SET payload='{}'::jsonb
                               WHERE received_at < now() - interval '${RETENTION.webhookPayloadsDays} days' AND payload <> '{}'::jsonb`),
    lockouts: await n(`DELETE FROM login_lockouts WHERE locked_until IS NOT NULL AND locked_until < now() - interval '1 day'`),
  };
  await record(db, 'retention', true, r);
  return r;
}

export const BACKUP_KEEP = 14;
export const backupDir = () => path.resolve(process.env.BACKUP_DIR ?? path.join(process.cwd(), '.data', 'backups'));

/**
 * Backup of the embedded database while the app keeps running: a compressed copy is written to BACKUP_DIR
 * (default .data/backups) and only the newest 14 are kept. Copy that folder off the computer regularly
 * (e.g. to Google Drive or OneDrive). With a hosted PostgreSQL database, use the provider's daily backups.
 */
export async function runBackup(db: Db) {
  if (!db.backup) {
    const details = { skipped: 'hosted database: use the provider backups (see TODO.md)' };
    await record(db, 'backup', true, details);
    return details;
  }
  try {
    const bytes = await db.backup();
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const name = `ahadi-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}.tar.gz`;
    fs.writeFileSync(path.join(dir, name), bytes);
    const all = fs.readdirSync(dir).filter((f) => /^ahadi-.*\.tar\.gz$/.test(f)).sort();
    const removed = all.slice(0, Math.max(0, all.length - BACKUP_KEEP));
    for (const f of removed) fs.rmSync(path.join(dir, f));
    const details = { file: name, bytes: bytes.length, kept: Math.min(all.length, BACKUP_KEEP), removed: removed.length };
    await record(db, 'backup', true, details);
    return details;
  } catch (e) {
    await record(db, 'backup', false, { error: (e as Error).message });
    throw e;
  }
}

/** For uptime monitors: is the app up and the database answering? No personal data. */
export async function health(db: Db) {
  const t0 = Date.now();
  await db.query('SELECT 1');
  const [m] = await db.query<{ n: number; last: string }>(`SELECT COUNT(*)::int AS n, MAX(name) AS last FROM schema_migrations`);
  const [b] = await db.query<{ at: string | null; ok: boolean | null }>(`SELECT created_at AS at, ok FROM ops_runs WHERE kind='backup' ORDER BY created_at DESC LIMIT 1`);
  return { ok: true, dbMs: Date.now() - t0, migrations: m.n, schema: m.last, lastBackup: b?.at ?? null, lastBackupOk: b?.ok ?? null, time: new Date().toISOString() };
}

export async function opsRuns(db: Db, limit = 20) {
  return db.query(`SELECT * FROM ops_runs ORDER BY created_at DESC LIMIT $1`, [limit]);
}
