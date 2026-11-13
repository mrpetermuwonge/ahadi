'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './I18n';
import { LOCALES, type Locale } from '@/i18n';
import { useOnline } from './client-utils';

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useT();
  if (online) return null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-warn text-white text-sm px-4 py-2 text-center">
      {t('offline.banner')}
    </div>
  );
}

export function LangSwitcher({ className = '' }: { className?: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span className="sr-only">{t('lang.label')}</span>
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
      <select
        className="bg-transparent font-medium py-2 pr-1 focus:outline-none focus:ring-2 focus:ring-brand rounded"
        value={locale}
        onChange={(e) => {
          document.cookie = `lang=${e.target.value};path=/;max-age=31536000;samesite=lax`;
          router.refresh();
        }}
      >
        {(Object.keys(LOCALES) as Locale[]).map((l) => (
          <option key={l} value={l}>{LOCALES[l]}</option>
        ))}
      </select>
    </label>
  );
}

/** Animated progress ring: collected (solid) and pledged (soft) against the target. */
export function ProgressRing({ collected, pledged, target, size = 168, label }: { collected: number; pledged: number; target: number | null; size?: number; label: React.ReactNode }) {
  const base = target && target > 0 ? target : Math.max(pledged, 1);
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const [anim, setAnim] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnim(1));
    return () => cancelAnimationFrame(id);
  }, []);
  const pc = Math.min(1, collected / base) * anim;
  const pp = Math.min(1, pledged / base) * anim;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="12" fill="none" className="stroke-line" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="12" fill="none" strokeLinecap="round" className="stroke-accent/40"
          strokeDasharray={c} strokeDashoffset={c * (1 - pp)} style={{ transition: 'stroke-dashoffset 1.2s ease-out' }} />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="12" fill="none" strokeLinecap="round" className="stroke-brand"
          strokeDasharray={c} strokeDashoffset={c * (1 - pc)} style={{ transition: 'stroke-dashoffset 1.4s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">{label}</div>
    </div>
  );
}

/** Small, dependency-free confetti burst. Only used on celebratory events. */
export function Confetti({ fire }: { fire: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!fire || !ref.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = ref.current;
    const ctx = cv.getContext('2d')!;
    cv.width = window.innerWidth;
    cv.height = window.innerHeight;
    const colors = ['#D69E2E', '#0D5C54', '#E26C46', '#F6E05E', '#4DBEAC'];
    const parts = Array.from({ length: 120 }, () => ({
      x: cv.width / 2, y: cv.height / 3,
      vx: (Math.random() - 0.5) * 12, vy: Math.random() * -12 - 2,
      s: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6,
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.1;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      }
      if (++frame < 140) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fire]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-50" />;
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'ok' | 'bad' | 'warn'; children: React.ReactNode }) {
  const cls = {
    info: 'bg-brand-soft text-ink border-brand/30',
    ok: 'bg-ok/10 text-ink border-ok/40',
    bad: 'bg-bad/10 text-ink border-bad/40',
    warn: 'bg-warn/10 text-ink border-warn/40',
  }[kind];
  const icon = { info: 'ℹ', ok: '✓', bad: '!', warn: '!' }[kind];
  return (
    <div role={kind === 'bad' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <span aria-hidden className="font-bold">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export function StateChip({ state }: { state: 'paid' | 'partial' | 'unpaid' | 'overdue' }) {
  const { t } = useT();
  const cls = {
    paid: 'bg-ok/15 text-ok',
    partial: 'bg-accent/20 text-ink',
    unpaid: 'bg-line text-muted',
    overdue: 'bg-bad/15 text-bad',
  }[state];
  const icon = { paid: '✓', partial: '◐', unpaid: '○', overdue: '!' }[state];
  return (
    <span className={`chip ${cls}`}>
      <span aria-hidden>{icon}</span>
      {t(`state.${state}` as any)}
    </span>
  );
}

export function CopyButton({ text, className = 'btn-outline' }: { text: string; className?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: the link is visible for manual copy */
        }
      }}
    >
      {done ? t('a.copied') : t('a.copy')}
    </button>
  );
}
