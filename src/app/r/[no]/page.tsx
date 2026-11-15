import Link from 'next/link';
import { notFound } from 'next/navigation';
import { receiptData } from '@/lib/services/receipts';
import { getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/time';
import { toneClass } from '@/lib/eventTypes';
import { BackLink } from '@/components/BackLink';
import { Logo } from '@/components/Brand';
import { ReceiptActions } from './ReceiptActions';
import type { Key } from '@/i18n';

export const metadata = { title: 'Receipt' };

/** Public receipt page. Shows the pledger name only if they did not choose to be anonymous. */
export default async function ReceiptPage({ params }: { params: { no: string } }) {
  const r = await receiptData(params.no);
  if (!r) notFound();
  const { t } = getT();
  const from = r.anonymous ? t('ev.anonymous') : r.display_name;
  const rows: [Key, string][] = [
    ['rc.no', r.receipt_no],
    ['rc.amount', formatMoney(Number(r.pledge_credit), r.currency)],
    ['rc.event', r.title],
    ['rc.from', from],
    ['rc.date', formatDate(r.succeeded_at)],
    ['rc.method', t(`pf.${r.method}` as Key)],
  ];
  return (
    <div className={`${toneClass(r.type)} min-h-screen`}>
      <header className="mx-auto max-w-md px-4 py-3"><Logo /></header>
      <nav className="mx-auto max-w-md px-4"><BackLink fallback={`/e/${r.slug}`} /></nav>
      <main className="mx-auto max-w-md px-4 pb-10">
        <div className="card p-6 mt-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{t('rc.title')}</h1>
            {r.status === 'refunded' ? <span className="chip bg-warn/15 text-warn">{t('pay.refunded')}</span> : <span className="chip bg-ok/15 text-ok">✓ {t('rc.verified')}</span>}
          </div>
          <p className="text-4xl font-extrabold mt-4">{formatMoney(Number(r.pledge_credit), r.currency)}</p>
          <dl className="mt-5 divide-y divide-line">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{t(k)}</dt>
                <dd className="font-semibold text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <ReceiptActions
            no={r.receipt_no}
            lines={rows.map(([k, v]) => [t(k), v])}
            heading={`Ahadi · ${t('rc.title')}`}
            amount={formatMoney(Number(r.pledge_credit), r.currency)}
          />
          <Link href={`/e/${r.slug}`} className="btn-ghost w-full mt-2">{r.title}</Link>
        </div>
      </main>
    </div>
  );
}
