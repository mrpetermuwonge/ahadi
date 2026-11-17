'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/I18n';
import { Alert, Confetti } from '@/components/Ui';
import { apiSend, digits, fmtMoney, newIdempotencyKey, useDraft, withCommas } from '@/components/client-utils';
import { PayOptions, computeQuote, detectNetwork, type PayChoice } from '@/components/PayOptions';
import { OrganizerLink, PledgeSummary, VerifyPanel, samePhone, usePledgerMe, type Me } from '@/components/PledgerAccess';

interface Props {
  event: { id: string; title: string; currency: string; noun: 'pledge' | 'contribution' | 'support'; confetti: boolean };
  quickAmounts: number[];
  fee: { percent: number; min: number };
  tips: number[];
}

interface Draft {
  name: string;
  phone: string;
  amount: string;
  message: string;
  anonymous: boolean;
  plan: 'now' | 'part' | 'later';
  partAmount: string;
  dueDate: string;
  consent: boolean;
  pay: PayChoice;
  payKey: string;
}

const today = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10); // Africa/Kampala (UTC+3)

/** Pledge flow: 1) who 2) how much 3) confirm + pay. Typed data is saved on the phone at every keystroke. */
export function PledgeFlow({ event, quickAmounts, fee, tips }: Props) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [doneLater, setDoneLater] = useState<string | null>(null);
  const [d, setD, clearDraft] = useDraft<Draft>(`ahadi:pf:${event.id}`, {
    name: '', phone: '', amount: '', message: '', anonymous: false, plan: 'now', partAmount: '', dueDate: '', consent: false,
    pay: { method: 'mtn', payPhone: '', coverFee: true, tip: 0 }, payKey: '',
  });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitting = useRef(false); // blocks a second tap before React re-renders the disabled button
  // Pledger identity: no account, nothing permanent. Every pledge needs a fresh one-time code sent to the number.
  const { me, setMe, forget } = usePledgerMe();
  const matched = me?.verified === true && samePhone(d.phone, me.phone) ? (me as Extract<Me, { verified: true }>) : null;
  const local = (e164: string) => e164.replace(/^\+256/, '0');

  // After the code is verified, fill in the name we already have for this number (only if the field is empty).
  useEffect(() => {
    if (me?.verified && me.name) setD((x) => ({ ...x, name: x.name || me.name || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Opening the form always starts a fresh pledge: never re-show a finished one.
  function start() {
    forget(); // entering the form always needs a new code
    setStep(1);
    setDoneLater(null);
    setDuplicate(false);
    setError(null);
    setOpen(true);
  }


  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  const amount = Number(digits(d.amount)) || 0;
  const payNow = d.plan === 'now' ? amount : d.plan === 'part' ? Math.min(Number(digits(d.partAmount)) || 0, amount) : 0;
  const q = computeQuote(payNow, fee, d.pay);
  const nounTitle = t(`noun.${event.noun}` as any);

  function next1(e: React.FormEvent) {
    e.preventDefault();
    if (d.name.trim().length < 2) return setError('invalid_name');
    if (digits(d.phone).length < 9) return setError('invalid_phone');
    if (!matched) return setError('verify_required');
    setError(null);
    const net = detectNetwork(d.phone);
    set({ pay: { ...d.pay, payPhone: d.pay.payPhone || d.phone, method: net ?? d.pay.method } });
    setStep(2);
  }
  function next2(e: React.FormEvent) {
    e.preventDefault();
    if (amount <= 0) return setError('invalid_amount');
    setError(null);
    setStep(3);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (!d.consent) return setError('consent_required');
    if (d.plan === 'part' && (payNow <= 0 || payNow >= amount)) return setError('invalid_amount');
    if (d.plan !== 'now' && !d.dueDate) return setError('due_date_required');
    setError(null);
    submitting.current = true;
    setBusy(true);
    try {
      await submitInner();
    } finally {
      submitting.current = false;
    }
  }

  async function submitInner() {
    // Remembers the pledge this phone just created, so a resend after a dropped connection pays it instead of failing as a duplicate.
    const tokenKey = `ahadi:pledge:${event.id}:${digits(d.phone).slice(-9)}`;
    let token: string | null = null;
    try {
      token = localStorage.getItem(tokenKey);
    } catch {
      token = null;
    }
    if (!token) {
      const r = await apiSend<{ token: string }>(
        '/api/pledges',
        {
          eventId: event.id, name: d.name, phone: d.phone, amount, message: d.message || null, anonymous: d.anonymous,
          payPlan: d.plan, dueDate: d.plan === 'now' ? null : d.dueDate, consent: d.consent, locale,
        },
        { onQueued: () => setQueued(true) },
      );
      setQueued(false);
      if (!r.ok) {
        setBusy(false);
        // A device that proved this number goes straight to its existing pledge; anyone else just gets the WhatsApp link.
        if (r.error === 'duplicate' && r.extra?.token) {
          window.location.href = `/p/${r.extra.token}`;
          return;
        }
        if (r.error === 'duplicate') return setDuplicate(true);
        // The verification expired (15 minutes) or was for another number: back to step 1 for a new code.
        if (r.error === 'verify_required') {
          setMe({ verified: false });
          setStep(1);
          return setError('verify_required');
        }
        return setError(r.error);
      }
      token = r.data.token;
      try {
        localStorage.setItem(tokenKey, token);
      } catch {
        /* ignore */
      }
    }
    if (payNow <= 0) {
      clearDraft();
      try {
        localStorage.removeItem(tokenKey); // finished: the next pledge must start from scratch
      } catch {
        /* ignore */
      }
      setMe({ verified: false }); // the code was used up by this pledge
      setDoneLater(token);
      setBusy(false);
      return;
    }
    const payKey = d.payKey || newIdempotencyKey();
    if (!d.payKey) set({ payKey });
    const p = await apiSend<{ id: string; redirectUrl: string | null }>(
      '/api/payments',
      { pledgeToken: token, amount: payNow, method: d.pay.method, phone: d.pay.method === 'card' ? null : d.pay.payPhone, coverFee: q.cover, tip: d.pay.tip, idempotencyKey: payKey },
      { onQueued: () => setQueued(true) },
    );
    setQueued(false);
    if (!p.ok) {
      setBusy(false);
      return setError(p.error);
    }
    clearDraft();
    try {
      localStorage.removeItem(tokenKey);
    } catch {
      /* ignore */
    }
    window.location.href = p.data.redirectUrl ?? `/pay/${p.data.id}`;
  }

  if (!open) {
    return (
      <div className="fixed bottom-0 inset-x-0 z-30 bg-card/95 backdrop-blur border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl flex gap-2">
          {/* All of the pledger's own pledges and their details (opens the portal, which asks for a code). */}
          <a href="/my" className="btn-outline shrink-0 px-4 flex-col gap-0 leading-tight text-sm">
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" />
            </svg>
            {t('nav.myPledges')}
          </a>
          <button className="btn-accent flex-1 text-lg" onClick={start}>{t(`noun.${event.noun}.verb` as any)}</button>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="pf-h" className="fixed inset-0 z-40 bg-surface overflow-y-auto">
      <Confetti fire={!!doneLater && event.confetti} />
      <div className="mx-auto max-w-md px-4 py-4">
        <div className="flex items-center justify-between">
          <button className="btn-ghost px-3 min-h-[44px]" onClick={() => (step > 1 && !doneLater ? setStep(step - 1) : setOpen(false))} aria-label={t('a.back')}>
            ← {t('a.back')}
          </button>
          {!doneLater && (
            <div className="flex items-center gap-2" aria-label={t('pf.step', { n: step })}>
              {[1, 2, 3].map((n) => <span key={n} className={`h-2 rounded-full transition-all ${n <= step ? 'w-6 bg-brand' : 'w-2 bg-line'}`} />)}
            </div>
          )}
          <button className="btn-ghost px-3 min-h-[44px]" onClick={() => setOpen(false)}>{t('a.close')}</button>
        </div>
        <p className="text-sm text-muted mt-2 truncate">{event.title}</p>

        {queued && <div className="mt-3"><Alert kind="warn">{t('offline.queued')}</Alert></div>}

        {doneLater ? (
          <div className="card p-6 mt-4 text-center">
            <div className="text-5xl" aria-hidden>✓</div>
            <h2 id="pf-h" ref={headingRef} tabIndex={-1} className="text-xl font-bold mt-2">{t('pf.laterDone', { date: d.dueDate })}</h2>
            <a href={`/p/${doneLater}`} className="btn-primary w-full mt-5">{t('pay.backToPledge')}</a>
            <a href="/login?next=/app/new" className="btn-ghost w-full mt-2">{t('grow.cta')}</a>
          </div>
        ) : duplicate ? (
          <div className="card p-6 mt-4">
            <h2 id="pf-h" ref={headingRef} tabIndex={-1} className="text-xl font-bold">{t('pf.dupTitle')}</h2>
            <p className="mt-2 text-muted">{t('pf.dupText', { phone: d.phone })}</p>
            <button className="btn-outline w-full mt-5" onClick={() => { setDuplicate(false); setStep(1); }}>{t('a.back')}</button>
          </div>
        ) : step === 1 ? (
          <form onSubmit={next1} className="card p-5 mt-4 space-y-4">
            <h2 id="pf-h" ref={headingRef} tabIndex={-1} className="text-xl font-bold">{t('pf.who')}</h2>
            <div>
              <label htmlFor="pf-name" className="label">{t('pf.name')}</label>
              <input id="pf-name" className="input" autoComplete="name" value={d.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
            </div>
            <div>
              <label htmlFor="pf-phone" className="label">{t('pf.phone')}</label>
              <input id="pf-phone" className="input" inputMode="tel" autoComplete="tel" placeholder="0772 123 456" value={d.phone} onChange={(e) => set({ phone: e.target.value })} required />
              <p className="hint">{t('pf.phoneHint')}</p>
            </div>
            {matched ? (
              <div className="rounded-xl bg-brand-soft/60 p-3 space-y-3">
                <Alert kind="ok">{t('gate.verified')}</Alert>
                <div className="flex items-center justify-between gap-2">
                  {/* "Welcome back" only for someone who really pledged before, and only with a real name (never a phone number). */}
                  <p className="font-bold">{matched.items.length === 0 ? '' : realFirstName(matched.name) ? t('me.welcome', { name: realFirstName(matched.name)! }) : t('me.welcomeNoName')}</p>
                  <button type="button" className="text-sm text-brand font-semibold min-h-[36px]"
                    onClick={async () => { await forget(); set({ phone: '' }); }}>
                    {t('me.notYou')}
                  </button>
                </div>
                <PledgeSummary me={matched} limit={2} />
                {matched.runsEvents && <OrganizerLink />}
              </div>
            ) : (
              <VerifyPanel phone={d.phone} title={t('gate.title')} hint={t('gate.why')} onVerified={(m) => { setMe(m); setError(null); }} />
            )}
            {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
            <button className="btn-primary w-full">{t('a.continue')}</button>
          </form>
        ) : step === 2 ? (
          <form onSubmit={next2} className="card p-5 mt-4 space-y-4">
            <h2 id="pf-h" ref={headingRef} tabIndex={-1} className="text-xl font-bold">{t('pf.howMuch')}</h2>
            <div className="grid grid-cols-3 gap-2">
              {quickAmounts.map((a) => (
                <button type="button" key={a} onClick={() => set({ amount: String(a) })}
                  className={`tap rounded-xl border-2 min-h-[56px] font-bold text-sm ${amount === a ? 'border-brand bg-brand-soft' : 'border-line bg-card'}`}>
                  {(a / 1000).toLocaleString('en-US')}k
                </button>
              ))}
            </div>
            <div>
              <label htmlFor="pf-amount" className="label">{t('pf.otherAmount')}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-semibold">{event.currency}</span>
                <input id="pf-amount" className="input pl-16 text-lg font-bold" inputMode="numeric" value={withCommas(d.amount)} onChange={(e) => set({ amount: digits(e.target.value) })} />
              </div>
            </div>
            <div>
              <label htmlFor="pf-msg" className="label">{t('pf.message')}</label>
              <textarea id="pf-msg" className="input" rows={2} maxLength={280} placeholder={t('pf.messagePh')} value={d.message} onChange={(e) => set({ message: e.target.value })} />
              <p className="hint">{t('pf.messageNote')}</p>
            </div>
            <label className="flex gap-3 items-center cursor-pointer min-h-[44px]">
              <input type="checkbox" className="w-5 h-5" checked={d.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} />
              <span>{t('pf.anonymous')}</span>
            </label>
            {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
            <button className="btn-primary w-full">{t('a.continue')}</button>
          </form>
        ) : (
          <form onSubmit={submit} className="card p-5 mt-4 space-y-4">
            <h2 id="pf-h" ref={headingRef} tabIndex={-1} className="text-xl font-bold">{t('pf.confirm')}</h2>
            <p className="rounded-xl bg-brand-soft p-3 font-medium">
              {t('pf.summary', { name: d.name, amount: fmtMoney(amount, event.currency), event: event.title })}
              <span className="sr-only"> ({nounTitle})</span>
            </p>
            <fieldset>
              <legend className="label">{t('pf.when')}</legend>
              <div className="grid gap-2">
                {(['now', 'part', 'later'] as const).map((p) => (
                  <label key={p} className={`tap flex items-center gap-3 rounded-xl border-2 px-4 min-h-[52px] cursor-pointer ${d.plan === p ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                    <input type="radio" name="plan" checked={d.plan === p} onChange={() => set({ plan: p })} className="w-5 h-5" />
                    <span className="font-medium">{t(p === 'now' ? 'pf.payNow' : p === 'part' ? 'pf.payPart' : 'pf.payLater')}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {d.plan === 'part' && (
              <div>
                <label htmlFor="pf-part" className="label">{t('pf.partAmount')}</label>
                <input id="pf-part" className="input font-bold" inputMode="numeric" value={withCommas(d.partAmount)} onChange={(e) => set({ partAmount: digits(e.target.value) })} />
              </div>
            )}
            {d.plan !== 'now' && (
              <div>
                <label htmlFor="pf-due" className="label">{t('pf.dueDate')}</label>
                <input id="pf-due" type="date" className="input" min={today()} value={d.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              </div>
            )}
            {payNow > 0 && <PayOptions amount={payNow} currency={event.currency} fee={fee} tips={tips} value={d.pay} onChange={(pay) => set({ pay })} />}
            <label className="flex gap-3 items-start cursor-pointer text-sm">
              <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0" checked={d.consent} onChange={(e) => set({ consent: e.target.checked })} />
              <span>{t('pf.consent')}</span>
            </label>
            {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
            <button className="btn-accent w-full text-lg" disabled={busy}>
              {busy ? t('a.loading') : payNow > 0 ? t('pf.payBtn', { amount: fmtMoney(q.total, event.currency) }) : t('pf.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** First name only if it is a real name (has letters, isn't a phone number). */
function realFirstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return /\p{L}/u.test(first) && !first.startsWith('+') ? first : null;
}
