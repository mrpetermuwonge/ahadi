'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

type Kind = 'phone' | 'email';
type Step = 'choose' | 'enter' | 'code';

/** Login: choose phone (code on WhatsApp) or email (code by email, or Google), then enter the 6-digit code. */
export function LoginForm({ next, google, initialError }: { next: string | null; google: boolean; initialError: string | null }) {
  const { t, locale } = useT();
  const [kind, setKind] = useState<Kind>('phone');
  const [step, setStep] = useState<Step>('choose');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ identifier: string; channel: string; devCode?: string } | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await apiSend<{ identifier: string; channel: string; devCode?: string }>('/api/auth/request', { kind, value, locale });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSent(r.data);
    setCode('');
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!sent) return;
    setBusy(true);
    setError(null);
    const r = await apiSend<{ redirect: string }>('/api/auth/verify', { kind, value: sent.identifier, code, intent: next ? 'organizer' : 'auto', next });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    // The server picks the portal: organizer dashboard, or pledger portal for numbers that only pledge.
    window.location.href = r.data.redirect;
  }

  const choose = (k: Kind) => {
    setKind(k);
    setValue('');
    setError(null);
    setStep('enter');
  };

  const sentText = sent && t(sent.channel === 'email' ? 'login.sentEmail' : sent.channel === 'sms' ? 'login.sentSms' : 'login.sentWhatsapp', { to: sent.identifier });

  return (
    <div className="card p-6">
      <h1 className="text-2xl font-bold">{t('login.title')}</h1>
      <p className="text-sm text-muted mt-1">{t('login.oneDoor')}</p>
      {error && <div className="mt-4"><Alert kind="bad">{t(`err.${error}` as any)}</Alert></div>}

      {step === 'choose' && (
        <div className="mt-5 space-y-3">
          <p className="text-muted">{t('login.choose')}</p>
          <button className="tap w-full flex items-center gap-4 rounded-2xl border-2 border-line hover:border-brand p-4 text-left min-h-[72px]" onClick={() => choose('phone')}>
            <span className="w-11 h-11 shrink-0 rounded-full bg-[#25D366] text-white flex items-center justify-center" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.2z"/></svg>
            </span>
            <span><span className="block font-bold">{t('login.byPhone')}</span><span className="block text-sm text-muted">{t('login.byPhoneHint')}</span></span>
          </button>
          <button className="tap w-full flex items-center gap-4 rounded-2xl border-2 border-line hover:border-brand p-4 text-left min-h-[72px]" onClick={() => choose('email')}>
            <span className="w-11 h-11 shrink-0 rounded-full bg-brand-soft text-brand flex items-center justify-center" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
            </span>
            <span><span className="block font-bold">{t('login.byEmail')}</span><span className="block text-sm text-muted">{t('login.byEmailHint')}</span></span>
          </button>
        </div>
      )}

      {step === 'enter' && (
        <div className="mt-5 space-y-4">
          {kind === 'email' && google && (
            <>
              <a href={`/api/auth/google/start?next=${encodeURIComponent(next ?? '/app')}`} className="btn-outline w-full">
                <svg aria-hidden width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
                {t('login.google')}
              </a>
              <div className="flex items-center gap-3 text-sm text-muted"><span className="flex-1 h-px bg-line" />{t('login.or')}<span className="flex-1 h-px bg-line" /></div>
            </>
          )}
          <form onSubmit={send} className="space-y-4">
            <div>
              <label htmlFor="ident" className="label">{t(kind === 'phone' ? 'login.phone' : 'login.email')}</label>
              {kind === 'phone' ? (
                <input id="ident" className="input text-lg" inputMode="tel" autoComplete="tel" placeholder="0772 123 456"
                  value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
              ) : (
                <input id="ident" type="email" className="input text-lg" inputMode="email" autoComplete="email" placeholder="name@gmail.com"
                  value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
              )}
              <p className="hint">{t(kind === 'phone' ? 'login.phoneHint' : 'login.emailHint')}</p>
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? t('a.loading') : t('login.sendCode')}</button>
          </form>
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('choose'); setError(null); }}>{t('login.changeMethod')}</button>
          <p className="text-xs text-muted">
            {t('login.consent')} <Link className="underline" href="/terms">{t('legal.terms')}</Link> · <Link className="underline" href="/privacy">{t('legal.privacy')}</Link>
          </p>
        </div>
      )}

      {step === 'code' && sent && (
        <form onSubmit={verify} className="mt-5 space-y-4">
          <p className="text-muted" role="status">{sentText}</p>
          {sent.devCode && <Alert kind="warn">{t('login.devCode', { code: sent.devCode })}</Alert>}
          <div>
            <label htmlFor="code" className="label">{t('login.code')}</label>
            <input id="code" className="input text-2xl tracking-[0.5em] text-center" inputMode="numeric" autoComplete="one-time-code"
              maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </div>
          <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? t('a.loading') : t('login.verify')}</button>
          <button type="button" className="btn-ghost w-full" onClick={() => { setStep('enter'); setCode(''); setError(null); }}>
            {t(kind === 'phone' ? 'login.change' : 'login.changeMethod')}
          </button>
        </form>
      )}
    </div>
  );
}
