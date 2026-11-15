import Link from 'next/link';
import { getDb } from '@/lib/db';
import { myEvents } from '@/lib/services/events';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatMoney, percent } from '@/lib/money';
import { formatDate } from '@/lib/time';
import { EVENT_GROUPS, toneClass, type EventType } from '@/lib/eventTypes';
import { FolderTabs, type FolderColor, type FolderTab } from '@/components/FolderTabs';
import { TypeIcon } from '@/components/Brand';
import type { Key } from '@/i18n';
import { NameForm } from './account/NameForm';

export const metadata = { title: 'My events' };

const TABS: { id: string; color: FolderColor }[] = [
  { id: 'all', color: 'brand' },
  { id: 'celebrations', color: 'amber' },
  { id: 'support', color: 'sky' },
  { id: 'community', color: 'rose' },
  { id: 'closed', color: 'slate' },
];

/** Which tab an event belongs to: closed events go to "Closed", open ones by kind of occasion. */
function tabOf(e: { status: string; type: string }): string {
  if (e.status !== 'active') return 'closed';
  const hit = (Object.keys(EVENT_GROUPS) as (keyof typeof EVENT_GROUPS)[]).find((g) => EVENT_GROUPS[g].includes(e.type as EventType));
  return hit ?? 'community';
}

export default async function MyEventsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser('/app');
  const { t } = getT();
  const all = await myEvents(await getDb(), user.id);
  const tab = TABS.some((x) => x.id === searchParams.tab) ? searchParams.tab! : 'all';
  const events = tab === 'all' ? all : all.filter((e) => tabOf(e) === tab);
  const tabs: FolderTab[] = TABS.map((x) => ({
    ...x,
    label: t(`dash.tab.${x.id}` as Key),
    count: x.id === 'all' ? all.length : all.filter((e) => tabOf(e) === x.id).length,
    href: x.id === 'all' ? '/app' : `/app?tab=${x.id}`,
  }));
  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('dash.myEvents')}</h1>
        <Link href="/app/new" className="btn-primary min-h-[44px]">+ {t('nav.new')}</Link>
      </div>
      {!user.name && (
        // A name makes pledge cards and the badge trustworthy ("Organised by Peter M."), so ask once, gently.
        <section className="card p-5 mt-4 border-2 border-accent/50">
          <p className="font-semibold">{t('acct.nudgeTitle')}</p>
          <p className="text-sm text-muted mt-1 mb-3">{t('acct.nudgeText')}</p>
          <NameForm initial="" compact />
        </section>
      )}
      {all.length === 0 ? (
        <div className="card p-8 mt-6 text-center">
          <svg aria-hidden className="mx-auto w-24 h-24 text-accent" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="3">
            <rect x="14" y="26" width="68" height="50" rx="10" /><path d="M14 40h68M34 18v14M62 18v14" /><circle cx="48" cy="58" r="8" className="fill-accent/20" />
          </svg>
          <p className="mt-4 font-semibold text-lg">{t('dash.noEvents')}</p>
          <Link href="/app/new" className="btn-accent mt-5">{t('dash.createFirst')}</Link>
        </div>
      ) : (
        <div className="mt-4">
        <FolderTabs tabs={tabs} active={tab} label={t('dash.myEvents')}>
        {events.length === 0 && <p className="py-8 text-center text-muted">{t('dash.tabEmpty')}</p>}
        <ul className="grid gap-3">
          {events.map((e) => {
            const pct = percent(e.totals.collected, e.target_amount ? Number(e.target_amount) : e.totals.pledged);
            return (
              <li key={e.id}>
                <Link href={`/app/e/${e.id}`} className={`${toneClass(e.type)} card tap p-4 flex gap-4 items-center hover:border-brand/40`}>
                  <span className="w-12 h-12 shrink-0 rounded-xl bg-brand-soft text-brand flex items-center justify-center"><TypeIcon type={e.type} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold truncate">{e.title}</span>
                    <span className="block text-sm text-muted">{t(`type.${e.type}` as Key)}{e.event_date ? ` · ${formatDate(e.event_date)}` : ''} · {t(`role.${e.role}` as Key)}</span>
                    <span className="mt-2 block h-2 rounded-full bg-line overflow-hidden"><span className="block h-full bg-brand rounded-full" style={{ width: `${pct}%` }} /></span>
                    <span className="mt-1 block text-sm"><b>{formatMoney(e.totals.collected, e.currency)}</b> <span className="text-muted">{t('dash.collected').toLowerCase()} · {t('dash.pledgers', { n: e.totals.pledgeCount })}</span></span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        </FolderTabs>
        </div>
      )}
    </div>
  );
}
