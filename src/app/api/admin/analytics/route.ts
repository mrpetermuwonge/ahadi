import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { analyticsCsv, platformAnalytics } from '@/lib/services/adminAnalytics';
import { api, apiAdmin } from '@/lib/web';

/** Analytics as CSV (finance and super admins). Every export is audit-logged. */
export const GET = api(async (req) => {
  const user = await apiAdmin('analytics.export');
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 30));
  const db = await getDb();
  const a = await platformAnalytics(db, days);
  await audit(db, { actor: user.id, action: 'admin.analytics_exported', entityType: 'analytics', entityId: String(days) });
  return new NextResponse(analyticsCsv(a), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ahadi-analytics-${days}d.csv"` },
  });
});
