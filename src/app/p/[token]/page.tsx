import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { getPledgeView } from '@/lib/services/pledges';
import { DEVICE_COOKIE, canViewPledge } from '@/lib/services/pledgerAccess';
import { getSettings } from '@/lib/settings';
import { EVENT_TYPES, isSombre, toneClass, type EventType } from '@/lib/eventTypes';
import { BackLink } from '@/components/BackLink';
import { PledgerBadge } from '@/components/PledgerBadge';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { MyPledge } from './MyPledge';
import { PortalGate } from './PortalGate';

export const metadata = { title: 'My pledge', robots: { index: false } };

/**
 * The pledger's personal page (link sent on WhatsApp). The link alone is not enough: the details show only
 * after a fresh one-time code to the pledge's own number. Leaving the portal ends that verification.
 */
export default async function PledgePage({ params }: { params: { token: string } }) {
  const db = await getDb();
  const v = await getPledgeView(db, params.token);
  if (!v) notFound();
  const p = v.pledge;
  const verified = await canViewPledge(db, cookies().get(DEVICE_COOKIE)?.value, params.token);
  const header = (
    <header className="mx-auto max-w-md flex items-center justify-between px-4 py-3"><Logo /><LangSwitcher /></header>
  );
  if (!verified) {
    return (
      <div className={`${toneClass(p.type)} min-h-screen`}>
        {header}
        <nav className="mx-auto max-w-md px-4"><BackLink fallback={`/e/${p.slug}`} /></nav>
        <main className="mx-auto max-w-md px-4 pb-10">
          <PortalGate token={params.token} eventTitle={p.title} />
        </main>
      </div>
    );
  }
  const s = await getSettings(db);
  const tpl = EVENT_TYPES[p.type as EventType];
  return (
    <div className={`${toneClass(p.type)} min-h-screen`}>
      {header}
      <nav className="mx-auto max-w-md px-4 flex items-center justify-between gap-3">
        <BackLink fallback={`/e/${p.slug}`} />
        <PledgerBadge name={p.pledger_name} phone={p.phone} label={getT().t('mine.title')} tag={getT().t('badge.pledger')} />
      </nav>
      <main className="mx-auto max-w-md px-4 pb-10">
        <MyPledge
          token={params.token}
          data={{
            title: p.title,
            slug: p.slug,
            name: p.pledger_name,
            phone: p.phone,
            currency: p.currency,
            pledged: v.balance.pledged,
            paid: v.balance.paid,
            balance: v.balance.balance,
            open: p.event_status === 'active' && !p.frozen,
            pendingChange: v.pendingChange ? Number(v.pendingChange.new_amount) : null,
            payments: v.payments.map((x) => ({ id: x.id, receiptNo: x.receipt_no, amount: Number(x.pledge_credit), status: x.status, date: new Date(x.created_at).toISOString().slice(0, 10) })),
            noun: tpl.noun,
            recorded: p.source === 'self' ? null : p.disputed_at ? 'disputed' : p.confirmed_at ? 'confirmed' : 'pending',
          }}
          fee={{ percent: s.fee_percent, min: s.fee_min }}
          tips={s.tips_enabled && !isSombre(p.type) ? s.tip_suggestions : []}
        />
      </main>
    </div>
  );
}
