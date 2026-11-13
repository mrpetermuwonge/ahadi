import fs from 'node:fs';
import path from 'node:path';

/** Deletes the local embedded database (development only). Does nothing when DATABASE_URL is set. */
if (process.env.DATABASE_URL) {
  console.error('DATABASE_URL is set: refusing to reset a real database.');
  process.exit(1);
}
const dir = path.join(process.cwd(), '.data', 'pglite');
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Run npm run db:seed to load demo data.`);
