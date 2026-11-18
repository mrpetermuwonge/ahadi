'use client';
import { useT } from './I18n';

export interface PartnerItem { id: string; name: string; tagline: string | null; url: string | null; logoFileId: string | null }

/**
 * Homepage "Our partners" strip: logos slide slowly from right to left in a loop (CSS only, no library).
 * Pauses when hovered or focused; people who ask their device for less motion get a still, swipeable row.
 */
export function PartnersStrip({ partners }: { partners: PartnerItem[] }) {
  const { t } = useT();
  if (partners.length === 0) return null;
  const loop = [...partners, ...partners]; // two copies so the slide joins up seamlessly
  const card = (p: PartnerItem, i: number, hidden: boolean) => {
    const inner = (
      <span className="flex items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 min-w-[250px] h-[84px]">
        {p.logoFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${p.logoFileId}`} alt="" className="w-14 h-14 rounded-xl object-contain shrink-0" loading="lazy" />
        ) : (
          <span aria-hidden className="w-14 h-14 shrink-0 rounded-xl bg-brand-soft text-brand font-extrabold flex items-center justify-center text-sm">
            {p.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </span>
        )}
        <span className="min-w-0">
          <span className="block font-bold text-sm truncate">{p.name}</span>
          {p.tagline && <span className="block text-xs text-muted truncate">{p.tagline}</span>}
        </span>
      </span>
    );
    return (
      <li key={`${p.id}-${i}`} aria-hidden={hidden || undefined} className="shrink-0">
        {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" tabIndex={hidden ? -1 : undefined} className="block tap">{inner}</a> : inner}
      </li>
    );
  };
  return (
    <section className="py-8" aria-labelledby="partners-title">
      <div className="mx-auto max-w-5xl px-4">
        <h2 id="partners-title" className="text-sm font-bold uppercase tracking-widest text-muted text-center">{t('pt.homeTitle')}</h2>
      </div>
      {/* Same width as the rest of the page; the logos fade out at both edges. */}
      <div className="mx-auto max-w-5xl px-4">
      <div className="partners-viewport mt-4 overflow-hidden">
        <ul className="partners-track flex gap-3 w-max">
          {loop.map((p, i) => card(p, i, i >= partners.length))}
        </ul>
      </div>
      </div>
      <style>{`
        .partners-viewport { -webkit-mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); mask-image: linear-gradient(90deg, transparent, #000 14%, #000 86%, transparent); }
        .partners-track { animation: partners-slide ${Math.max(20, partners.length * 5)}s linear infinite; }
        .partners-viewport:hover .partners-track, .partners-viewport:focus-within .partners-track { animation-play-state: paused; }
        @keyframes partners-slide { from { transform: translateX(0); } to { transform: translateX(calc(-50% - 6px)); } }
        @media (prefers-reduced-motion: reduce) {
          .partners-viewport { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
          .partners-track { animation: none; }
        }
      `}</style>
    </section>
  );
}
