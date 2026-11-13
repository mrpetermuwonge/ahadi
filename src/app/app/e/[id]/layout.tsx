import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db';
import { eventForUser } from '@/lib/services/events';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { toneClass } from '@/lib/eventTypes';
import { Alert } from '@/components/Ui';
import { Tabs } from './Tabs';

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: { id: string } }) {
  const user = await requireUser(`/app/e/${params.id}`);
  const { t } = getT();
  const ctx = await eventForUser(await getDb(), params.id, user, 'viewer').catch(() => null);
  if (!ctx) notFound();
  const { event: e, role } = ctx;
  const base = `/app/e/${e.id}`;
  const tabs = [
    { href: base, label: t('nav.home') },
    { href: `${base}/share`, label: t('dash.share') },
    { href: `${base}/ledger`, label: t('dash.ledger') },
    { href: `${base}/committee`, label: t('dash.committee') },
    ...(role === 'owner' || role === 'treasurer' ? [{ href: `${base}/payouts`, label: t('dash.payouts') }] : []),
    ...(role === 'owner' ? [{ href: `${base}/settings`, label: t('dash.settings') }] : []),
  ];
  return (
    <div className={toneClass(e.type)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{e.title}</h1>
        </div>
        <a href={`/e/${e.slug}`} className="btn-outline min-h-[40px] px-3 text-sm shrink-0" target="_blank" rel="noopener">{t('a.view')}</a>
      </div>
      {e.frozen && <div className="mt-3"><Alert kind="warn">{t('dash.frozen')}</Alert></div>}
      <Tabs tabs={tabs} />
      <div className="mt-4">{children}</div>
    </div>
  );
}
