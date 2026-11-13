import { NextResponse } from 'next/server';
import { receiptData } from '@/lib/services/receipts';
import { toReceiptPdf } from '@/lib/exports';
import { getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/time';
import type { Key } from '@/i18n';

export async function GET(_req: Request, { params }: { params: { no: string } }) {
  const r = await receiptData(params.no);
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { t } = getT();
  const amount = formatMoney(Number(r.pledge_credit), r.currency);
  const lines: [string, string][] = [
    [t('rc.no'), r.receipt_no],
    [t('rc.event'), r.title],
    [t('rc.from'), r.anonymous ? t('ev.anonymous') : r.display_name],
    [t('rc.date'), formatDate(r.succeeded_at)],
    [t('rc.method'), t(`pf.${r.method}` as Key)],
  ];
  const bytes = await toReceiptPdf(lines, amount, `Ahadi - ${t('rc.title')}`);
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="ahadi-receipt-${r.receipt_no}.pdf"` },
  });
}
