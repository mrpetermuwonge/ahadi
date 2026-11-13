import { notFound } from 'next/navigation';
import { BackLink } from '@/components/BackLink';
import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { publicEvent } from '@/lib/services/events';
import { getSettings } from '@/lib/settings';
import { getT } from '@/i18n/server';
import { EVENT_TYPES, isSombre, toneClass, type EventType } from '@/lib/eventTypes';
import { formatMoney, percent } from '@/lib/money';
import { formatDate } from '@/lib/time';
import { COUNTRIES } from '@/lib/countries';
import { Logo, TypeIcon } from '@/components/Brand';
import { LangSwitcher, ProgressRing } from '@/components/Ui';
import { PledgeFlow } from './PledgeFlow';
import { ReportButton } from './ReportButton';
import type { Key } from '@/i18n';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await publicEvent(await getDb(), params.slug);
  return data ? { title: data.event.title, description: data.event.story.slice(0, 150) } : {};
}

export default async function EventPage({ params }: { params: { slug: string } }) {
  const db = await getDb();
  const data = await publicEvent(db, params.slug);
  if (!data) notFound();
  const { event: e, totals, messages, supporters } = data;
  const { t } = getT();
  const tpl = EVENT_TYPES[e.type as EventType];
  const settings = await getSettings(db);
  const open = e.status === 'active' && !e.frozen;
  const target = e.target_amount ? Number(e.target_amount) : null;
  const pct = percent(totals.collected, target ?? totals.pledged);
  const details = Object.entries(e.details as Record<string, string>).filter(([, v]) => v);

  return (
    <div className={`${toneClass(e.type)} min-h-screen pb-28`}>
      <header className="mx-auto max-w-2xl flex items-center justify-between px-4 py-3">
        <Logo />
        <LangSwitcher />
      </header>
      <nav className="mx-auto max-w-2xl px-4"><BackLink fallback="/" /></nav>
      <main className="mx-auto max-w-2xl px-4">
        <article className="card overflow-hidden">
          {e.cover_file_id ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${e.cover_file_id}`} alt="" loading="lazy" className="w-full aspect-[16/9] object-cover bg-brand-soft" />
          ) : (
            <div className="w-full aspect-[16/7] bg-gradient-to-br from-accent/60 to-brand/70 flex items-center justify-center text-white/90">
              <TypeIcon type={e.type} className="w-14 h-14" />
            </div>
          )}
          <div className="p-5">
            <div className="flex flex-wrap gap-2 mb-2">
              <span className="chip bg-brand-soft text-brand"><TypeIcon type={e.type} className="w-3.5 h-3.5" />{t(`type.${e.type}` as Key)}</span>
              {e.verified && <span className="chip bg-ok/15 text-ok">✓ {t('ev.verified')}</span>}
              {e.urgent && <span className="chip bg-bad/15 text-bad">! {t('ev.urgent')}</span>}
            </div>
            <h1 className="text-2xl font-extrabold leading-tight">{e.title}</h1>
            {e.event_date && <p className="text-muted mt-1">{formatDate(e.event_date)}</p>}

            <div className="mt-6 flex flex-col sm:flex-row items-center gap-6">
              <ProgressRing
                collected={totals.collected}
                pledged={totals.pledged}
                target={target}
                label={
                  <>
                    <span className="text-3xl font-extrabold">{pct}%</span>
                    <span className="text-xs text-muted">{t('ev.raised')}</span>
                  </>
                }
              />
              <dl className="grid grid-cols-2 sm:grid-cols-1 gap-3 w-full">
                <div>
                  <dt className="text-sm text-muted">{t('dash.collected')}</dt>
                  <dd className="text-xl font-bold">{formatMoney(totals.collected, e.currency)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">{t('dash.pledged')}</dt>
                  <dd className="text-xl font-bold">{formatMoney(totals.pledged, e.currency)}</dd>
                </div>
                {target && (
                  <div className="col-span-2 sm:col-span-1">
                    <dt className="text-sm text-muted">{t('dash.target')}</dt>
                    <dd className="font-semibold">{formatMoney(target, e.currency)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {e.story && <p className="mt-6 whitespace-pre-line leading-relaxed">{e.story}</p>}
            {details.length > 0 && (
              <dl className="mt-5 grid gap-2 text-sm">
                {details.map(([k, v]) => {
                  const f = tpl.fields.find((x) => x.key === k);
                  return f ? (
                    <div key={k} className="flex gap-2"><dt className="text-muted">{t(f.labelKey as Key)}:</dt><dd className="font-medium">{v}</dd></div>
                  ) : null;
                })}
              </dl>
            )}
            <p className="mt-6 text-sm text-muted flex gap-2">
              <svg aria-hidden className="w-5 h-5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>
              {t('ev.fundsHeld')} {t('ev.receipts')}
            </p>
          </div>
        </article>

        {messages.length > 0 && (
          <section className="card p-5 mt-4">
            <h2 className="font-bold text-lg">{t('ev.messages')}</h2>
            <ul className="mt-3 space-y-3">
              {messages.map((m, i) => (
                <li key={i} className="rounded-xl bg-surface p-3">
                  <p>“{m.message}”</p>
                  <p className="text-sm text-muted mt-1">— {m.name ?? t('ev.anonymous')}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {supporters.length > 0 && (
          <section className="card p-5 mt-4">
            <h2 className="font-bold text-lg">{t('ev.supporters')}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {supporters.map((s, i) => (
                <li key={i} className="chip bg-brand-soft text-ink text-sm py-1">{s.name ?? t('ev.anonymous')}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 text-center">
          <ReportButton eventId={e.id} />
        </div>
      </main>

      {open ? (
        <PledgeFlow
          event={{ id: e.id, title: e.title, currency: e.currency, noun: tpl.noun, confetti: tpl.confetti }}
          quickAmounts={COUNTRIES.UG.quickAmounts}
          fee={{ percent: settings.fee_percent, min: settings.fee_min }}
          tips={settings.tips_enabled && e.tips_enabled && !isSombre(e.type) ? settings.tip_suggestions : []}
        />
      ) : (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t border-line p-4 text-center font-semibold">{e.frozen ? t('dash.frozen') : t('ev.closed')}</div>
      )}
    </div>
  );
}
