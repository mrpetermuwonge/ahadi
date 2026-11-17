/**
 * Browser tests for every role, in a real browser (Microsoft Edge or Chrome already on the computer).
 * Run: npm run test:e2e
 *
 * It never touches your data: it starts a separate copy of the app on port 3300 with its own fresh demo database
 * (.data/e2e-<time>) and its own build folder (.next-e2e), runs the checks, then stops and deletes that database.
 * Set E2E_BROWSER=chrome to use Chrome instead of Edge, E2E_HEADED=1 to watch it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 3300);
const BASE = `http://localhost:${PORT}`;
const dbDir = path.join(root, '.data', `e2e-${Date.now()}`);
const env = {
  ...process.env,
  PGLITE_DIR: dbDir,
  NEXT_DIST_DIR: '.next-e2e',
  APP_URL: BASE,
  PORT: String(PORT),
  OTP_SHOW_ON_SCREEN: 'true',
  INTERNAL_CRON: 'false',
  PAYMENT_PROVIDERS: 'mock',
  ADMIN_PHONES: '+256700000001',
  ALERT_WEBHOOK_URL: '',
};
const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, env, stdio: 'inherit', shell: isWin });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

async function waitFor(url, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`server did not start: ${url}`);
}

let server;
let failed = 0;
try {
  console.log('• Seeding a fresh demo database for the browser tests…');
  await run(npx, ['tsx', 'scripts/seed.ts']);
  console.log(`• Starting a test copy of the app on ${BASE}…`);
  server = spawn(npx, ['next', 'dev', '-p', String(PORT)], { cwd: root, env, stdio: 'ignore', shell: isWin });
  await waitFor(`${BASE}/api/health`);
  const { runRoleTests } = await import('../tests/e2e/roles.e2e.mjs');
  failed = await runRoleTests(BASE);
} catch (e) {
  console.error(e);
  failed = failed || 1;
} finally {
  if (server) {
    if (isWin) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill('SIGTERM');
  }
  await new Promise((r) => setTimeout(r, 2000));
  fs.rmSync(dbDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
