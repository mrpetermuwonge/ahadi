/**
 * Restore the embedded database from a backup made by the app (Admin → System, or the nightly job).
 *
 *   1. Stop the app (close the server).
 *   2. npm run db:restore -- .data/backups/ahadi-2026-11-17-07-04.tar.gz
 *   3. Start the app again.
 *
 * The current database is never deleted: it is moved aside to .data/pglite-before-restore-<time>.
 * Use --to <folder> to restore into another folder (e.g. to inspect an old backup without touching the app).
 */
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const toIdx = args.indexOf('--to');
  const target = path.resolve(toIdx >= 0 ? args[toIdx + 1] : path.join(process.cwd(), '.data', 'pglite'));
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: npm run db:restore -- <backup .tar.gz> [--to <folder>]');
    process.exit(1);
  }
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    const aside = `${target}-before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(target, aside); // fails if the app is still running and holding the folder: stop it first
    console.log(`Current database moved aside to: ${aside}`);
  }
  fs.mkdirSync(target, { recursive: true });
  const { PGlite } = await import('@electric-sql/pglite');
  const blob = new Blob([fs.readFileSync(file)]);
  const db = new PGlite(target, { loadDataDir: blob });
  const r = await db.query<{ n: number; m: string }>(`SELECT (SELECT COUNT(*) FROM events)::int AS n, (SELECT MAX(name) FROM schema_migrations) AS m`);
  await db.close();
  console.log(`Restored ${path.basename(file)} into ${target}: ${r.rows[0]!.n} events, schema ${r.rows[0]!.m}.`);
}

main().catch((e) => {
  console.error('Restore failed:', e.message);
  process.exit(1);
});
