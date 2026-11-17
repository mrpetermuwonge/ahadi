'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from './I18n';
import { Alert, StateChip } from './Ui';
import { apiGet, apiSend, digits, fmtMoney } from './client-utils';
import { TypeIcon } from './Brand';

export interface SummaryItem {
  token: string; eventTitle: string; eventSlug: string; eventType: string; coverFileId: string | null; open: boolean; currency: string;
  pledged: number; paid: number; balance: number; dueDate: string | null; createdAt: string;
  state: 'paid' | 'partial' | 'unpaid' | 'overdue'; lastPaidAt: string | null;
}
export type Me =
  | { verified: false }
  | { verified: true; phone: string; name: string | null; runsEvents?: boolean; items: SummaryItem[];
      totals: { currency: string; pledged: number; paid: number; balance: number }[]; next: SummaryItem | null };

/** End any pledger verification on this browser (the pledger left their portal). */
export function endPledgerSession() {
  return apiSend('/api/pledger/forget', {});
}

/**
 * Pledger verification state for a page that is an ENTRY to the portal (pledge form, My pledges):
 * entering always starts unverified, so a new code is needed every time. Also runs when the page is
 * shown again from the browser's back/forward cache.
 */
export function usePledgerMe(opts: { entry?: boolean } = {}) {
  const entry = opts.entry !== false;
  const [me, setMe] = useState<Me | null>(null);
  const reset = useCallback(async () => {
    setMe({ verified: false });
    await endPledgerSession();
  }, []);
  const refresh = useCallback(async () => {
    const r = await apiGet<Me>('/api/pledger/me');
    setMe(r.ok ? r.data : { verified: false });
  }, []);
  useEffect(() => {
    // Entry pages (the pledge form) always start locked; the portal page itself shows the current verification.
    if (entry) reset();
    else refresh();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) (entry ? reset : refresh)();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [entry, reset, refresh]);
  return { me, setMe, refresh, forget: reset };
}

/** For pages outside the portal (homepage): visiting them ends the pledger's verification. */
export function EndPledgerSession() {
  useEffect(() => {
    endPledgerSession();
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) endPledgerSession();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  return null;
}

/** Same number? Compares the last 9 digits so 07xx / +2567xx / 2567xx all match. */
export const samePhone = (a: string, b: string) => digits(a).slice(-9) === digits(b).slice(-9) && digits(a).length >= 9;

/**
 * One-time code check: send a code to the number (WhatsApp, SMS fallback), then type it.
 * Shows its own phone field only when the parent has not already collected the number.
 * Not a <form>: it can sit inside the pledge form, and forms cannot be nested, so Enter is handled by hand.
 */
export function VerifyPanel({ phone: givenPhone, onVerified, title, hint }: {
  phone?: string;
  onVerified: (me: Me) => void;
  title?: string;
  hint?: string;
}) {
  const { t, locale } = useT();
  const [phone, setPhone] = useState(givenPhone ?? '');
  const [sent, setSent] = useState<{ channel: string; phone: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const number = givenPhone ?? phone;

  // A code belongs to one number: if the number is changed after sending, start again.
  useEffect(() => {
    if (sent && !samePhone(number, sent.phone)) {
      setSent(null);
      setCode('');
    }
  }, [number, sent]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await apiSend<{ channel: string; phone: string; devCode?: string }>('/api/pledger/code', { phone: number, locale });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSent(r.data);
    setCode('');
  }

  async function verify() {
    if (busy || code.length !== 6 || !sent) return;
    setBusy(true);
    setError(null);
    const r = await apiSend<Me>('/api/pledger/verify', { phone: sent.phone, code });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onVerified(r.data);
  }

  const enter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }
  };

  return (
    <div className="rounded-xl border-2 border-brand/40 bg-brand-soft/40 p-4 space-y-3" aria-live="polite">
      <div>
        <p className="font-bold">🔒 {title ?? t('me.verifyTitle')}</p>
        <p className="text-sm text-muted">{hint ?? t('me.verifyHint')}</p>
      </div>
      {givenPhone === undefined && (
        <div>
          <label htmlFor="v-phone" className="label">{t('pf.phone')}</label>
          <input id="v-phone" className="input" inputMode="tel" autoComplete="tel" placeholder="0772 123 456" value={phone}
            onKeyDown={enter(() => { if (!sent) send(); })} onChange={(e) => setPhone(e.target.value)} />
        </div>
      )}
      {digits(number).length < 9 ? (
        <p className="text-sm text-muted">{t('gate.enterPhoneFirst')}</p>
      ) : !sent ? (
        <button type="button" className="btn-primary w-full" disabled={busy} onClick={send}>
          {busy ? t('a.loading') : t('me.sendCode')}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm" role="status">{t(sent.channel === 'sms' ? 'login.sentSms' : 'login.sentWhatsapp', { to: sent.phone })}</p>
          {sent.devCode && <Alert kind="warn">{t('login.devCode', { code: sent.devCode })}</Alert>}
          <label htmlFor="v-code" className="label">{t('login.code')}</label>
          <input id="v-code" className="input text-xl tracking-[0.4em] text-center" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onKeyDown={enter(verify)} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button type="button" onClick={verify} className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? t('a.loading') : t('gate.verify')}</button>
          <button type="button" className="text-sm text-brand font-semibold min-h-[36px]" disabled={busy} onClick={send}>{t('gate.resend')}</button>
        </div>
      )}
      {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
    </div>
  );
}

/** Totals (pledged so far / paid / still to pay), what is due next, and each pledge with a pay link. */
export function PledgeSummary({ me, limit = 3, views = false }: { me: Extract<Me, { verified: true }>; limit?: number; views?: boolean }) {
  const { t } = useT();
  const [all, setAll] = useState(false);
  // Slides (with the organizers' photos) or a compact list. The choice is remembered on this phone.
  const [view, setView] = useState<'slides' | 'list'>('slides');
  useEffect(() => {
    try {
      const v = localStorage.getItem('ahadi:pledgeView');
      if (v === 'list' || v === 'slides') setView(v);
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  const choose = (v: 'slides' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('ahadi:pledgeView', v);
    } catch {
      /* ignore */
    }
  };
  if (me.items.length === 0) return <p className="text-sm text-muted">{t('me.none')}</p>;
  const shown = all ? me.items : me.items.slice(0, limit);
  const showSlides = views && view === 'slides';
  return (
    <div className="space-y-3">
      {me.totals.map((x) => (
        <dl key={x.currency} className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-card p-2"><dt className="text-[11px] text-muted">{t('me.pledged')}</dt><dd className="font-bold text-sm">{fmtMoney(x.pledged, x.currency)}</dd></div>
          <div className="rounded-xl bg-card p-2"><dt className="text-[11px] text-muted">{t('me.paid')}</dt><dd className="font-bold text-sm text-ok">{fmtMoney(x.paid, x.currency)}</dd></div>
          <div className="rounded-xl bg-card p-2"><dt className="text-[11px] text-muted">{t('me.left')}</dt><dd className="font-bold text-sm">{fmtMoney(x.balance, x.currency)}</dd></div>
        </dl>
      ))}
      {me.next && (
        <p className="text-sm rounded-xl bg-accent-soft px-3 py-2">
          {t('me.next', { amount: fmtMoney(me.next.balance, me.next.currency), event: me.next.eventTitle, date: me.next.dueDate ?? '' })}
        </p>
      )}
      {views && (
        <div className="flex justify-end">
          <div className="inline-flex rounded-xl border border-line bg-card p-1" role="tablist" aria-label={t('me.summaryTitle')}>
            {(['slides', 'list'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => choose(v)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 min-h-[36px] text-sm font-semibold ${view === v ? 'bg-brand text-brand-ink' : 'text-muted'}`}>
                <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  {v === 'slides' ? <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="M19 7v10M22 9v6" /></> : <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />}
                </svg>
                {t(v === 'slides' ? 'me.viewSlides' : 'me.viewList')}
              </button>
            ))}
          </div>
        </div>
      )}
      {showSlides ? <PledgeSlides items={me.items} /> : (
      <ul className="divide-y divide-line rounded-xl bg-card">
        {shown.map((i) => {
          const pct = i.pledged > 0 ? Math.min(100, Math.round((i.paid / i.pledged) * 100)) : 0;
          return (
            <li key={i.token} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{i.eventTitle}</p>
                  <p className="text-xs text-muted">
                    {i.balance > 0 && i.dueDate ? t('me.due', { date: i.dueDate }) : ''}
                    {i.lastPaidAt ? `${i.balance > 0 && i.dueDate ? ' · ' : ''}${t('me.lastPaid', { date: i.lastPaidAt })}` : ''}
                    {!i.open ? ` · ${t('me.closed')}` : ''}
                  </p>
                </div>
                <StateChip state={i.state} />
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} /></div>
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span>{fmtMoney(i.paid, i.currency)} / {fmtMoney(i.pledged, i.currency)}{i.balance > 0 && <b> · {t('me.left')}: {fmtMoney(i.balance, i.currency)}</b>}</span>
                <a href={`/p/${i.token}`} className="font-bold text-brand shrink-0 ml-2">{i.balance > 0 && i.open ? t('me.pay') : t('me.open')} →</a>
              </div>
            </li>
          );
        })}
      </ul>
      )}
      {!showSlides && me.items.length > limit && (
        <button type="button" className="btn-ghost w-full min-h-[36px] text-sm" onClick={() => setAll(!all)}>{all ? t('me.showLess') : t('me.showAll')}</button>
      )}
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  wedding: 'tone-celebratory', birthday: 'tone-playful', hospital: 'tone-calm', funeral: 'tone-dignified', community: 'tone-neutral', other: 'tone-neutral',
};

/**
 * Slide view of the pledger's pledges: one card per pledge with the organizer's cover photo (or the event's
 * colour banner), status, progress and a Pay / Open button. Swipe on phones, arrows and dots elsewhere.
 * It does not move on its own: these are the person's own figures, read at their pace.
 */
function PledgeSlides({ items }: { items: SummaryItem[] }) {
  const { t } = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const goTo = (i: number) => {
    const el = track.current;
    if (!el) return;
    const n = (i + items.length) % items.length;
    const card = el.children[n] as HTMLElement | undefined;
    if (card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' });
    setIndex(n);
  };
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    setIndex(Math.min(items.length - 1, Math.round(el.scrollLeft / (w + 12))));
  };
  return (
    <div aria-roledescription="carousel" aria-label={t('me.summaryTitle')}>
      <div ref={track} onScroll={onScroll} className="flex gap-3 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((i, n) => {
          const pct = i.pledged > 0 ? Math.min(100, Math.round((i.paid / i.pledged) * 100)) : 0;
          return (
            <div key={i.token} role="group" aria-roledescription="slide" aria-label={t('home.slide', { n: n + 1, total: items.length })}
              className={`${TONE_CLASS[i.eventType] ?? ''} snap-start shrink-0 w-[88%] sm:w-[calc(50%-6px)] rounded-2xl bg-card border border-line/60 shadow-soft overflow-hidden`}>
              <div className="relative">
                {i.coverFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${i.coverFileId}`} alt="" loading="lazy" className="w-full aspect-[16/9] object-cover bg-brand-soft" />
                ) : (
                  <div className="w-full aspect-[16/9] bg-gradient-to-br from-accent/60 to-brand/80 flex items-center justify-center text-white/90">
                    <TypeIcon type={i.eventType} className="w-12 h-12" />
                  </div>
                )}
                <span className="absolute top-2 right-2"><StateChip state={i.state} /></span>
              </div>
              <div className="p-4">
                <p className="font-bold text-lg leading-snug line-clamp-2 min-h-[3.2rem]">{i.eventTitle}</p>
                <p className="text-xs text-muted min-h-[1rem]">
                  {i.balance > 0 && i.dueDate ? t('me.due', { date: i.dueDate }) : ''}
                  {i.lastPaidAt ? `${i.balance > 0 && i.dueDate ? ' · ' : ''}${t('me.lastPaid', { date: i.lastPaidAt })}` : ''}
                  {!i.open ? ` · ${t('me.closed')}` : ''}
                </p>
                <div className="mt-3 h-2 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand rounded-full" style={{ width: `${pct}%` }} /></div>
                <dl className="mt-3 grid grid-cols-3 gap-1 text-center">
                  <div><dt className="text-[10px] text-muted">{t('my.pledged')}</dt><dd className="text-xs font-bold">{fmtMoney(i.pledged, i.currency)}</dd></div>
                  <div><dt className="text-[10px] text-muted">{t('my.paid')}</dt><dd className="text-xs font-bold text-ok">{fmtMoney(i.paid, i.currency)}</dd></div>
                  <div><dt className="text-[10px] text-muted">{t('me.left')}</dt><dd className="text-xs font-bold">{fmtMoney(Math.max(0, i.balance), i.currency)}</dd></div>
                </dl>
                <a href={`/p/${i.token}`} className={`${i.balance > 0 && i.open ? 'btn-accent' : 'btn-outline'} w-full mt-4`}>
                  {i.balance > 0 && i.open ? t('me.pay') : t('me.open')} →
                </a>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <button type="button" className="btn-ghost min-h-[36px] px-2" aria-label={t('home.prev')} onClick={() => goTo(index - 1)}>←</button>
          {items.map((i, n) => (
            <button key={i.token} type="button" aria-label={t('home.slide', { n: n + 1, total: items.length })} aria-current={n === index} onClick={() => goTo(n)} className="p-1">
              <span className={`block h-2 rounded-full transition-all ${n === index ? 'w-5 bg-brand' : 'w-2 bg-ink/25'}`} />
            </button>
          ))}
          <button type="button" className="btn-ghost min-h-[36px] px-2" aria-label={t('home.next')} onClick={() => goTo(index + 1)}>→</button>
        </div>
      )}
    </div>
  );
}

/** Shown to a verified number that also runs events: one tap to the organizer dashboard. */
export function OrganizerLink() {
  const { t } = useT();
  return (
    <form method="post" action="/api/auth/from-pledger">
    <button type="submit" className="w-full text-left flex items-center justify-between gap-3 rounded-xl border-2 border-accent/60 bg-accent-soft px-4 py-3 tap">
      <span>
        <span className="block font-bold text-sm">{t('me.organizerTitle')}</span>
        <span className="block text-sm text-brand font-semibold">{t('me.openDashboard')} →</span>
      </span>
      <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand shrink-0"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
    </button>
    </form>
  );
}
