import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { eventAccess } from '@/lib/services/events';
import { loadExport, toCsv, toEventDayPdf, toLedgerPdf, toXlsx } from '@/lib/exports';
import { getT } from '@/i18n/server';
import { api, apiUser } from '@/lib/web';
import { audit } from '@/lib/audit';

/** Ledger exports. Same numbers as the dashboard because both read the ledger through the same functions. */
export const GET = api(async (req, { params }: { params: { id: string } }) => {
  const user = await apiUser();
  const db = await getDb();
  // Exports contain full phone numbers and every payment: owner and treasurer only.
  const { event } = await eventAccess(db, params.id, user, 'ledger.export');
  const format = new URL(req.url).searchParams.get('format') ?? 'csv';
  const { t } = getT();
  const data = await loadExport(db, params.id);
  await audit(db, { actor: user.id, action: 'ledger.exported', entityType: 'event', entityId: event.id, eventId: event.id, details: { format } });
  const base = event.slug;
  if (format === 'xlsx') {
    return new NextResponse(new Uint8Array(await toXlsx(data, t)), {
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${base}.xlsx"` },
    });
  }
  if (format === 'pdf' || format === 'report') {
    const bytes = format === 'pdf' ? await toLedgerPdf(data, t) : await toEventDayPdf(data, t);
    return new NextResponse(Buffer.from(bytes), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${base}-${format}.pdf"` },
    });
  }
  return new NextResponse(toCsv(data, t), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${base}.csv"` },
  });
});
