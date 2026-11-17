import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { health } from '@/lib/services/ops';
import { reportError } from '@/lib/monitor';

/**
 * Health check for uptime monitors (UptimeRobot, Better Stack, your host): 200 when the app and the database
 * answer, 503 when not. Point the monitor at {APP_URL}/api/health every 1-5 minutes. No personal data.
 */
export async function GET() {
  try {
    return NextResponse.json(await health(await getDb()), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    reportError(e, 'health');
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}

export const dynamic = 'force-dynamic';
