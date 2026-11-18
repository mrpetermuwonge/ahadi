'use client';
import { useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

/**
 * Shown instead of the pledge details when this browser has not verified the pledge's number just now.
 * The code goes to the pledge's own number; the visitor only ever sees it masked (0772 *** 555).
 */
export function PortalGate({ token, eventTitle }: { token: string; eventTitle: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [sent, setSent] = useState<{ channel: string; phone: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await apiSend<{ channel: string; phone: string; devCode?: string }>('/api/pledger/pledge-code', { token, locale });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSent(r.data);
    setCode('');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    const r = await apiSend('/api/pledger/pledge-verify', { token, code });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    startTransition(() => router.refresh()); // the page now shows the pledge
  }

  return (
    <section className="card p-6 mt-2 space-y-4">
      <div>
        <p className="text-sm text-muted">{t('my.title')}</p>
        <h1 className="text-xl font-bold">{eventTitle}</h1>
      </div>
      <div className="rounded-xl border-2 border-brand/40 bg-brand-soft/40 p-4 space-y-3" aria-live="polite">
        <p className="font-bold">🔒 {t('portal.title')}</p>
        <p className="text-sm text-muted">{t('portal.why')}</p>
        {!sent ? (
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={send}>{busy ? t('a.loading') : t('portal.send')}</button>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm" role="status">{t(sent.channel === 'sms' ? 'login.sentSms' : 'login.sentWhatsapp', { to: sent.phone })}</p>
            {sent.devCode && <Alert kind="warn">{t('login.devCode', { code: sent.devCode })}</Alert>}
            <label htmlFor="pg-code" className="label">{t('login.code')}</label>
            <input id="pg-code" className="input text-xl tracking-[0.4em] text-center" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? t('a.loading') : t('gate.verify')}</button>
            <button type="button" className="text-sm text-brand font-semibold min-h-[36px]" disabled={busy} onClick={send}>{t('gate.resend')}</button>
          </form>
        )}
        {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
      </div>
    </section>
  );
}
