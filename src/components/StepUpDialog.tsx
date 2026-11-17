'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from './I18n';

declare global {
  interface Window {
    /** Opens "Confirm it's you"; resolves true once a fresh code was verified, false if cancelled. */
    __ahadiStepUp?: () => Promise<boolean>;
  }
}

/**
 * "Confirm it's you" for money and committee actions. apiSend() opens it automatically when the server answers
 * step_up_required, then retries the action. Mounted once in the root layout.
 */
export function StepUpDialog() {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/step-up', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'generic');
    setTo(j.to ?? '');
    setDevCode(j.devCode ?? null);
    setTimeout(() => input.current?.focus(), 50);
  }

  useEffect(() => {
    window.__ahadiStepUp = () =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setCode('');
        setError(null);
        setDevCode(null);
        setTo('');
        setOpen(true);
        void send();
      });
    return () => { delete window.__ahadiStepUp; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  function close(ok: boolean) {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) return setError('invalid_code');
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/step-up', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.error ?? 'generic');
    close(true);
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-ink/50 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
      <div className="card w-full max-w-sm p-5">
        <div className="flex items-center gap-2">
          <svg aria-hidden className="w-6 h-6 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
          <h2 id="stepup-title" className="text-lg font-bold">{t('step.title')}</h2>
        </div>
        <p className="text-sm text-muted mt-1">{t('step.why')}</p>
        {to && <p className="text-sm mt-3">{t('step.sent', { to })}</p>}
        {devCode && <p className="text-sm mt-2 rounded-lg bg-accent-soft px-3 py-2">{t('login.devCode', { code: devCode })}</p>}
        <label className="label mt-3" htmlFor="stepup-code">{t('login.code')}</label>
        <input id="stepup-code" ref={input} className="input text-center text-2xl tracking-[.4em] font-bold" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }} />
        {error && <p role="alert" className="text-sm text-bad mt-2">{t(`err.${error}` as any)}</p>}
        <button type="button" className="btn-primary w-full mt-4" disabled={busy} onClick={verify}>{busy ? t('a.loading') : t('step.confirm')}</button>
        <div className="flex justify-between mt-2">
          <button type="button" className="btn-ghost min-h-[40px] px-2 text-sm" disabled={busy} onClick={send}>{t('step.resend')}</button>
          <button type="button" className="btn-ghost min-h-[40px] px-2 text-sm" onClick={() => close(false)}>{t('a.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
