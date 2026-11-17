import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { safeEqual } from '@/lib/ids';
import { runPendingPayments, runReconciliation, runReminders } from '@/lib/services/jobs';
import { runBackup, runRetention } from '@/lib/services/ops';
import { reportError } from '@/lib/monitor';

/**
 * Background jobs, called by a scheduler (Vercel Cron, GitHub Actions, cron + curl) with the x-cron-secret header.
 *   reminders      every 15 minutes
 *   pending        every 2 minutes  (expire stale mobile money prompts, confirm payouts)
 *   reconcile      daily at 02:00 Africa/Kampala
 *   retention      daily (data clean-up)
 *   backup         daily (embedded database copy)
 */
export async function POST(req: Request, { params }: { params: { job: string } }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = await getDb();
  const jobs: Record<string, () => Promise<unknown>> = {
    reminders: () => runReminders(db),
    pending: () => runPendingPayments(db),
    reconcile: () => runReconciliation(db),
    retention: () => runRetention(db),
    backup: () => runBackup(db),
  };
  const run = jobs[params.job];
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    return NextResponse.json(await run());
  } catch (e) {
    // A failing background job alerts the team (ALERT_WEBHOOK_URL) instead of failing silently.
    const ref = reportError(e, `cron:${params.job}`);
    return NextResponse.json({ error: 'job_failed', ref }, { status: 500 });
  }
}
