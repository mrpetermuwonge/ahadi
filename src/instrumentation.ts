/**
 * Built-in scheduler for the background jobs (reminders, stale payment prompts, daily reconciliation).
 * Turned on with INTERNAL_CRON=true. Use it when Ahadi runs as one long-lived server (your PC, a VPS, Railway,
 * Render...). On serverless hosts (e.g. Vercel) leave it off and call /api/cron/* from the host's cron instead.
 *
 * It calls the app's own /api/cron endpoints over HTTP rather than running the jobs here, so the jobs use the
 * same database connection as the rest of the app (important with the embedded database, which must only be
 * opened once).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.INTERNAL_CRON !== 'true') return;
  const g = globalThis as typeof globalThis & { __ahadiCron?: boolean };
  if (g.__ahadiCron) return; // dev hot-reload can call register() again
  g.__ahadiCron = true;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron] INTERNAL_CRON is on but CRON_SECRET is empty: background jobs will not run.');
    return;
  }
  const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  const run = async (job: 'reminders' | 'pending' | 'reconcile') => {
    try {
      const res = await fetch(`${base}/api/cron/${job}`, { method: 'POST', headers: { 'x-cron-secret': secret } });
      if (!res.ok) console.warn(`[cron] ${job} answered ${res.status}`);
    } catch (e) {
      console.warn(`[cron] ${job} failed:`, (e as Error).message);
    }
  };
  const MIN = 60_000;
  // Give the server a moment to start, then run on a fixed rhythm.
  setTimeout(() => {
    void run('pending');
    void run('reminders');
    setInterval(() => void run('pending'), 2 * MIN);
    setInterval(() => void run('reminders'), 15 * MIN);
    // Reconciliation once a day at 02:00 Kampala time (checked every 10 minutes).
    let lastDay = '';
    setInterval(() => {
      const now = new Date();
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Kampala' }).format(now));
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(now);
      if (hour === 2 && day !== lastDay) {
        lastDay = day;
        void run('reconcile');
      }
    }, 10 * MIN);
    console.log('[cron] built-in scheduler on: reminders every 15 min, payments every 2 min, reconcile daily 02:00');
  }, 20_000);
}
