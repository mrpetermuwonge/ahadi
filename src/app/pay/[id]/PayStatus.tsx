'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useT } from '@/components/I18n';
import { Alert, Confetti } from '@/components/Ui';
import { apiGet, apiSend, fmtMoney } from '@/components/client-utils';

interface P { id: string; status: string; charged: number; currency: string; receiptNo: string | null; method: string; provider: string }

/** "Check your phone" screen: live status, 60-second countdown, safe resend. */
export function PayStatus({ initial, createdAt, timeoutSec, backHref, isPledge, eventTitle, confetti, mockRef }: {
  initial: P; createdAt: number; timeoutSec: number; backHref: string; isPledge: boolean; eventTitle: string; confetti: boolean; mockRef: string | null;
}) {
  const { t } = useT();
  const [p, setP] = useState<P>(initial);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = p.status === 'pending' || p.status === 'created';
  const left = Math.max(0, Math.ceil(timeoutSec - (now - createdAt) / 1000));

  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const r = await apiGet<P>(`/api/payments/${p.id}`);
      if (r.ok) setP(r.data);
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pending, p.id]);

  async function retry() {
    setBusy(true);
    setError(null);
    const r = await apiSend<{ id: string; redirectUrl: string | null }>(`/api/payments/${p.id}/retry`, {});
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.href = r.data.redirectUrl ?? `/pay/${r.data.id}`;
  }

  async function simulate(outcome: string) {
    if (!mockRef) return;
    await apiSend(`/api/mock/${mockRef}`, { outcome });
    const r = await apiGet<P>(`/api/payments/${p.id}`);
    if (r.ok) setP(r.data);
  }

  if (p.status === 'succeeded') {
    return (
      <div className="card p-6 mt-4 text-center">
        <Confetti fire={confetti} />
        <div className="mx-auto w-16 h-16 rounded-full bg-ok/15 text-ok flex items-center justify-center text-3xl" aria-hidden>✓</div>
        <h1 className="text-2xl font-bold mt-3" role="status">{t('pay.success')}</h1>
        <p className="text-muted mt-1">{fmtMoney(p.charged, p.currency)} · {eventTitle}</p>
        {isPledge && <Link href={`/r/${p.receiptNo}`} className="btn-primary w-full mt-6">{t('pay.viewReceipt')}</Link>}
        <a href={backHref} className="btn-ghost w-full mt-2">{isPledge ? t('pay.backToPledge') : t('a.back')}</a>
        {isPledge && <div className="mt-6 rounded-xl bg-accent-soft p-4 text-left">
          <p className="font-bold">{t('grow.title')}</p>
          <p className="text-sm text-muted">{t('grow.text')}</p>
          <Link href="/login?next=/app/new" className="btn-outline w-full mt-3">{t('grow.cta')}</Link>
        </div>}
      </div>
    );
  }

  if (p.status === 'failed' || p.status === 'expired' || p.status === 'refunded') {
    return (
      <div className="card p-6 mt-4 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-bad/10 text-bad flex items-center justify-center text-3xl" aria-hidden>!</div>
        <h1 className="text-xl font-bold mt-3" role="alert">{t(p.status === 'failed' ? 'pay.failed' : p.status === 'expired' ? 'pay.expired' : 'pay.refunded')}</h1>
        {error && <div className="mt-3"><Alert kind="bad">{t(`err.${error}` as any)}</Alert></div>}
        {isPledge && p.status !== 'refunded' && <button className="btn-primary w-full mt-6" onClick={retry} disabled={busy}>{busy ? t('a.loading') : t('a.retry')}</button>}
        <a href={backHref} className="btn-ghost w-full mt-2">{isPledge ? t('pay.backToPledge') : t('a.back')}</a>
      </div>
    );
  }

  const isCard = p.method === 'card';
  return (
    <div className="card p-6 mt-4 text-center">
      <div className="mx-auto relative w-20 h-20" aria-hidden>
        <div className="absolute inset-0 rounded-full border-4 border-line" />
        <div className="absolute inset-0 rounded-full border-4 border-brand border-t-transparent animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">📱</div>
      </div>
      <h1 className="text-2xl font-bold mt-4">{t('pay.checkPhone')}</h1>
      <p className="mt-2" aria-live="polite">{t('pay.approvePrompt', { amount: fmtMoney(p.charged, p.currency) })}</p>
      {!isCard && <p className="mt-4 text-4xl font-extrabold tabular-nums" aria-label={t('pay.seconds', { s: left })}>{left > 0 ? t('pay.seconds', { s: left }) : '0'}</p>}
      {left === 0 && isPledge && (
        <>
          <p className="text-sm text-muted mt-3">{t('pay.noPrompt')}</p>
          <button className="btn-outline w-full mt-4" onClick={retry} disabled={busy}>{busy ? t('a.loading') : t('pay.resend')}</button>
        </>
      )}
      {error && <div className="mt-3"><Alert kind="bad">{t(`err.${error}` as any)}</Alert></div>}

      {mockRef && (
        <div className="mt-8 rounded-xl border-2 border-dashed border-warn/60 p-4 text-left">
          <p className="text-sm font-bold text-warn">{t('pay.mockTitle')}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button className="btn-primary text-sm" onClick={() => simulate('success')}>{t('pay.mockApprove')}</button>
            <button className="btn-danger text-sm" onClick={() => simulate('fail')}>{t('pay.mockDecline')}</button>
            <button className="btn-outline text-sm" onClick={() => simulate('timeout')}>{t('pay.mockTimeout')}</button>
            <button className="btn-outline text-sm" onClick={() => simulate('duplicate')}>{t('pay.mockDuplicate')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
