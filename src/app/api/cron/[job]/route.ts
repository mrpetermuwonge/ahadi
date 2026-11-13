import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { safeEqual } from '@/lib/ids';
import { runPendingPayments, runReconciliation, runReminders } from '@/lib/services/jobs';

/**
 * Background jobs, called by a scheduler (Vercel Cron, GitHub Actions, cron + curl) with the x-cron-secret header.
 *   reminders      every 15 minutes
 *   pending        every 2 minutes  (expire stale mobile money prompts, confirm payouts)
 *   reconcile      daily at 02:00 Africa/Kampala
 */
export async function POST(req: Request, { params }: { params: { job: string } }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const db = await getDb();
  if (params.job === 'reminders') return NextResponse.json(await runReminders(db));
  if (params.job === 'pending') return NextResponse.json(await runPendingPayments(db));
  if (params.job === 'reconcile') return NextResponse.json(await runReconciliation(db));
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}
