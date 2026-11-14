'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from './I18n';
import { FolderTabs, type FolderTab } from './FolderTabs';
import { TypeIcon } from './Brand';
import { fmtMoney } from './client-utils';

export interface Slide {
  slug: string;
  title: string;
  type: string;
  organizerKind: string;
  coverFileId: string | null;
  currency: string;
  collected: number;
  target: number | null;
  pledgeCount: number;
  verified: boolean;
  urgent: boolean;
}

const TONE: Record<string, string> = {
  wedding: 'tone-celebratory', birthday: 'tone-playful', hospital: 'tone-calm', funeral: 'tone-dignified', community: 'tone-neutral', other: 'tone-neutral',
};
const TABS: { id: string; kinds: string[]; color: FolderTab['color'] }[] = [
  { id: 'all', kinds: [], color: 'brand' },
  { id: 'people', kinds: ['individual', 'group'], color: 'sky' },
  { id: 'faith', kinds: ['faith', 'nonprofit'], color: 'rose' },
  { id: 'org', kinds: ['company', 'school'], color: 'amber' },
];
const INTERVAL_MS = 5000;

/**
 * Homepage showcase: folder tabs (who is organising) over an auto-advancing slideshow.
 * Swipe or scroll on phones (CSS scroll-snap, no library), arrows and dots on larger screens.
 * Pauses on hover, focus or touch; never moves on its own if the device asks for reduced motion.
 */
export function FeaturedEvents({ slides }: { slides: Slide[] }) {
  const { t } = useT();
  const [tab, setTab] = useState('all');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hold, setHold] = useState(false);
  const track = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const def = TABS.find((x) => x.id === tab)!;
    return def.kinds.length ? slides.filter((s) => def.kinds.includes(s.organizerKind)) : slides;
  }, [slides, tab]);

  const tabs: FolderTab[] = TABS.map((x) => ({
    id: x.id,
    color: x.color,
    label: x.id === 'all' ? t('home.all') : t(`home.tab.${x.id}` as any),
    count: x.kinds.length ? slides.filter((s) => x.kinds.includes(s.organizerKind)).length : slides.length,
  }));

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el || shown.length === 0) return;
    const n = (i + shown.length) % shown.length;
    const card = el.children[n] as HTMLElement | undefined;
    if (card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    setIndex(n);
  }, [shown.length]);

  // Keep the dots in step when the user swipes by hand.
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    setIndex(Math.min(shown.length - 1, Math.round(el.scrollLeft / (w + 12))));
  };

  useEffect(() => {
    setIndex(0);
    track.current?.scrollTo({ left: 0 });
  }, [tab]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || hold || shown.length < 2) return;
    const id = setInterval(() => goTo(index + 1), INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, hold, index, shown.length, goTo]);

  if (slides.length === 0) return null;

  return (
    <section id="happening" aria-roledescription="carousel" aria-label={t('home.title')} className="mx-auto max-w-5xl px-4 pb-10 scroll-mt-4">
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold">{t('home.title')}</h2>
          <p className="text-muted">{t('home.sub')}</p>
        </div>
        {shown.length > 1 && (
          <div className="hidden sm:flex gap-2 shrink-0">
            <button type="button" className="btn-outline min-h-[40px] px-3" aria-label={playing ? t('home.pause') : t('home.play')} onClick={() => setPlaying(!playing)}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="btn-outline min-h-[40px] px-3" aria-label={t('home.prev')} onClick={() => goTo(index - 1)}>←</button>
            <button type="button" className="btn-outline min-h-[40px] px-3" aria-label={t('home.next')} onClick={() => goTo(index + 1)}>→</button>
          </div>
        )}
      </div>

      <FolderTabs tabs={tabs} active={tab} onSelect={setTab} label={t('who.label')}>
        {shown.length === 0 ? (
          <p className="py-10 text-center text-muted">{t('home.empty')}</p>
        ) : (
          <>
            <div
              ref={track}
              onScroll={onScroll}
              onMouseEnter={() => setHold(true)}
              onMouseLeave={() => setHold(false)}
              onFocus={() => setHold(true)}
              onBlur={() => setHold(false)}
              onTouchStart={() => setHold(true)}
              className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-live={playing && !hold ? 'off' : 'polite'}
            >
              {shown.map((s, i) => {
                const pct = s.target ? Math.min(100, Math.round((s.collected / s.target) * 100)) : null;
                return (
                  <a
                    key={s.slug}
                    href={`/e/${s.slug}`}
                    role="group"
                    aria-roledescription="slide"
                    aria-label={t('home.slide', { n: i + 1, total: shown.length })}
                    className={`${TONE[s.type] ?? ''} snap-start shrink-0 w-[85%] sm:w-[calc(50%-6px)] lg:w-[calc(33.333%-8px)] card overflow-hidden tap hover:shadow-lg transition-shadow`}
                  >
                    {s.coverFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${s.coverFileId}`} alt="" loading="lazy" className="w-full aspect-[16/9] object-cover bg-brand-soft" />
                    ) : (
                      <div className="w-full aspect-[16/9] bg-gradient-to-br from-accent/60 to-brand/80 flex items-center justify-center text-white/90">
                        <TypeIcon type={s.type} className="w-12 h-12" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="chip bg-brand-soft text-brand"><TypeIcon type={s.type} className="w-3 h-3" />{t(`type.${s.type}` as any)}</span>
                        {s.verified && <span className="chip bg-ok/15 text-ok">✓ {t('ev.verified')}</span>}
                        {s.urgent && <span className="chip bg-bad/15 text-bad">! {t('ev.urgent')}</span>}
                      </div>
                      <h3 className="font-bold text-lg leading-snug mt-2 line-clamp-2 min-h-[3.2rem]">{s.title}</h3>
                      <p className="text-xs text-muted">{t(`who.${s.organizerKind}` as any)}</p>
                      <div className="mt-3 h-2 rounded-full bg-line overflow-hidden">
                        <div className="h-full bg-brand rounded-full" style={{ width: `${pct ?? 100}%` }} />
                      </div>
                      <p className="mt-2 text-sm">
                        <b>{t('home.raised', { amount: fmtMoney(s.collected, s.currency) })}</b>{' '}
                        {s.target && <span className="text-muted">{t('home.of', { target: fmtMoney(s.target, s.currency) })}</span>}
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted">{t('home.supporters', { n: s.pledgeCount })}</span>
                        <span className="text-sm font-bold text-brand">{t('home.see')} →</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
            {shown.length > 1 && (
              <div className="flex justify-center gap-1.5 mt-3">
                {shown.map((s, i) => (
                  <button key={s.slug} type="button" aria-label={t('home.slide', { n: i + 1, total: shown.length })} aria-current={i === index}
                    onClick={() => goTo(i)} className="p-1.5">
                    <span className={`block h-2 rounded-full transition-all ${i === index ? 'w-6 bg-brand' : 'w-2 bg-ink/25'}`} />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </FolderTabs>
    </section>
  );
}
