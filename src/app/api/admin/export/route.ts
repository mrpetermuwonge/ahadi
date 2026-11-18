import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { audit } from '@/lib/audit';
import { adminRoleOf } from '@/lib/adminPermissions';
import { ANALYTICS_ROLES, DATASETS, PHONE_ROLES, buildExport, toCsvSheet, toXlsxWorkbook } from '@/lib/services/adminExport';
import { platformAnalytics } from '@/lib/services/adminAnalytics';
import { api, apiAdmin, jsonError, requireStepUp } from '@/lib/web';

const Body = z.object({
  datasets: z.array(z.string().max(20)).max(20),
  analytics: z.boolean().default(false),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  type: z.enum(['wedding', 'birthday', 'hospital', 'funeral', 'community', 'other']).nullable(),
  phones: z.boolean().default(false),
  format: z.enum(['xlsx', 'csv']).default('xlsx'),
});

/**
 * Admin data export with chosen sections. Each dataset is limited to certain staff roles; files with personal
 * data need a fresh code; every export is audit-logged with what was taken.
 */
export const POST = api(async (req) => {
  const user = await apiAdmin('admin.view');
  const role = adminRoleOf(user)!;
  const b = Body.parse(await req.json());
  const allowed = b.datasets.filter((k) => DATASETS.some((d) => d.key === k && d.roles.includes(role)));
  const wantsAnalytics = b.analytics && ANALYTICS_ROLES.includes(role);
  if (allowed.length !== b.datasets.length || (b.analytics && !wantsAnalytics)) return jsonError('forbidden', 403);
  if (allowed.length === 0 && !wantsAnalytics) return jsonError('invalid_input');
  if (b.phones && !PHONE_ROLES.includes(role)) return jsonError('forbidden', 403);
  const personal = b.phones || allowed.some((k) => DATASETS.find((d) => d.key === k)!.personal);
  if (personal) await requireStepUp();

  const db = await getDb();
  const filters = { from: b.from, to: b.to, type: b.type, phones: b.phones };
  const { sheets, fullPhones } = await buildExport(db, allowed, filters, role);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  await audit(db, {
    actor: user.id, action: 'admin.data_exported', entityType: 'export', entityId: stamp,
    details: { datasets: allowed, analytics: wantsAnalytics, filters, rows: Object.fromEntries(sheets.map((s) => [s.key, s.rows.length])), format: b.format },
  });

  if (b.format === 'csv' && sheets.length === 1 && !wantsAnalytics) {
    return new NextResponse('﻿' + toCsvSheet(sheets[0]!), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ahadi-${sheets[0]!.key}-${stamp}.csv"` },
    });
  }
  const days = b.from ? Math.max(1, Math.ceil((Date.now() - Date.parse(b.from)) / 86_400_000)) : 30;
  const about: [string, string][] = [
    ['Exported by', `${user.name ?? user.phone ?? user.email} (${role})`],
    ['Exported at', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'],
    ['Sections', [...allowed, ...(wantsAnalytics ? ['analytics summary'] : [])].join(', ')],
    ['From', b.from ?? 'the beginning'],
    ['To', b.to ?? 'today'],
    ['Event type', b.type ?? 'all'],
    ['Phone numbers', fullPhones ? 'full (handle with care)' : 'hidden (0772 *** 456)'],
    ['Amounts', 'UGX, from the Ahadi ledger (same source as dashboards)'],
    ['Confidential', 'Contains Ahadi business and personal data. Do not share outside Ahadi. Delete when no longer needed.'],
  ];
  const xlsx = await toXlsxWorkbook(sheets, about, wantsAnalytics ? await platformAnalytics(db, Math.min(365, days)) : undefined);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="ahadi-export-${stamp}.xlsx"`,
    },
  });
});
