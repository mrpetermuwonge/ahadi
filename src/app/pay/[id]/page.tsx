import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { getPayment } from '@/lib/services/payments';
import { getSettings } from '@/lib/settings';
import { toneClass, EVENT_TYPES, type EventType } from '@/lib/eventTypes';
import { BackLink } from '@/components/BackLink';
import { PledgerBadge } from '@/components/PledgerBadge';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';
import { PayStatus } from './PayStatus';

export const metadata = { title: 'Payment', robots: { index: false } };

/** Payment status screen for pledges and for organizer purchases (Event Pass, SMS credits). */
export default async function PayPage({ params }: { params: { id: string } }) {
  const db = await getDb();
  const p = await getPayment(db, params.id);
  if (!p) notFound();
  const [ctx] = await db.query(
    `SELECT e.id AS event_id, e.type, e.title, pg.access_token, pl.name AS pledger_name, pl.phone AS pledger_phone,
            (SELECT ref FROM mock_transactions m WHERE m.reference=$1 ORDER BY created_at DESC LIMIT 1) AS mock_ref
       FROM events e LEFT JOIN pledges pg ON pg.id=$2 LEFT JOIN pledgers pl ON pl.id=pg.pledger_id WHERE e.id=$3`,
    [p.id, p.pledge_id, p.event_id],
  );
  if (!ctx) notFound();
  const settings = await getSettings(db);
  const tpl = EVENT_TYPES[ctx.type as EventType];
  const backHref = p.purpose === 'pledge' ? `/p/${ctx.access_token}` : `/app/e/${ctx.event_id}/settings`;
  return (
    <div className={`${toneClass(ctx.type)} min-h-screen`}>
      <header className="mx-auto max-w-md px-4 py-3"><Logo /></header>
      <nav className="mx-auto max-w-md px-4 flex items-center justify-between gap-3">
        <BackLink fallback={backHref} />
        {ctx.pledger_name && <PledgerBadge name={ctx.pledger_name} phone={ctx.pledger_phone} label={getT().t('mine.title')} tag={getT().t('badge.pledger')} />}
      </nav>
      <main className="mx-auto max-w-md px-4 pb-10">
        <PayStatus
          initial={{ id: p.id, status: p.status, charged: Number(p.charged_amount), currency: p.currency, receiptNo: p.receipt_no, method: p.method, provider: p.provider }}
          createdAt={new Date(p.created_at).getTime()}
          timeoutSec={settings.mobile_money_timeout_seconds}
          backHref={backHref}
          isPledge={p.purpose === 'pledge'}
          eventTitle={ctx.title}
          confetti={tpl.confetti && p.purpose === 'pledge'}
          mockRef={p.provider === 'mock' ? ctx.mock_ref : null}
        />
      </main>
    </div>
  );
}
