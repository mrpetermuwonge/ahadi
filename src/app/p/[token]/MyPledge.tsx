'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, digits, fmtMoney, newIdempotencyKey, useDraft, withCommas } from '@/components/client-utils';
import { PayOptions, computeQuote, detectNetwork, type PayChoice } from '@/components/PayOptions';

interface Data {
  title: string; slug: string; name: string; phone: string; currency: string;
  pledged: number; paid: number; balance: number; open: boolean;
  pendingChange: number | null;
  payments: { id: string; receiptNo: string | null; amount: number; status: string; date: string }[];
  noun: string;
  /** Pledges the committee recorded for this person (at a meeting or from a list). */
  recorded: 'pending' | 'confirmed' | 'disputed' | null;
}

export function MyPledge({ token, data, fee, tips }: { token: string; data: Data; fee: { percent: number; min: number }; tips: number[] }) {
  const { t } = useT();
  const router = useRouter();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'none' | 'pay' | 'change'>('none');
  const [payAmount, setPayAmount] = useState(String(Math.max(0, data.balance)));
  const [newAmount, setNewAmount] = useState(String(data.pledged));
  const [pay, setPay, clearPay] = useDraft<PayChoice & { key: string }>(`ahadi:my:${token}`, {
    method: detectNetwork(data.phone) ?? 'mtn', payPhone: data.phone.replace(/^\+256/, '0'), coverFee: true, tip: 0, key: '',
  });
  const amt = Number(digits(payAmount)) || 0;
  const q = computeQuote(amt, fee, pay);
  const err = (code: string) => setMsg({ kind: 'bad', text: t(`err.${code}` as any) });

  async function startPay(e: React.FormEvent) {
    e.preventDefault();
    if (amt <= 0) return err('invalid_amount');
    setBusy(true);
    const key = pay.key || newIdempotencyKey();
    if (!pay.key) setPay({ ...pay, key });
    const r = await apiSend<{ id: string; redirectUrl: string | null }>('/api/payments', {
      pledgeToken: token, amount: amt, method: pay.method, phone: pay.method === 'card' ? null : pay.payPhone, coverFee: q.cover, tip: pay.tip, idempotencyKey: key,
    });
    setBusy(false);
    if (!r.ok) return err(r.error);
    clearPay();
    window.location.href = r.data.redirectUrl ?? `/pay/${r.data.id}`;
  }

  async function action(path: string, body: unknown, okText: string) {
    setBusy(true);
    const r = await apiSend(`/api/p/${token}/${path}`, body);
    setBusy(false);
    if (!r.ok) return err(r.error);
    setMsg({ kind: 'ok', text: okText });
    setMode('none');
    router.refresh();
  }

  const pct = data.pledged > 0 ? Math.min(100, Math.round((data.paid / data.pledged) * 100)) : 0;

  return (
    <div className="space-y-4 mt-2">
      <section className="card p-6">
        <p className="text-sm text-muted">{t('my.title')}</p>
        <h1 className="text-xl font-bold">{data.title}</h1>
        <div className="mt-4 h-3 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
        <dl className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div><dt className="text-xs text-muted">{t('my.pledged')}</dt><dd className="font-bold">{fmtMoney(data.pledged, data.currency)}</dd></div>
          <div><dt className="text-xs text-muted">{t('my.paid')}</dt><dd className="font-bold text-ok">{fmtMoney(data.paid, data.currency)}</dd></div>
          <div><dt className="text-xs text-muted">{t('my.balance')}</dt><dd className="font-bold">{fmtMoney(Math.max(0, data.balance), data.currency)}</dd></div>
        </dl>
        {data.recorded === 'pending' && (
          <div className="mt-4 rounded-xl border-2 border-accent/60 bg-accent-soft/50 p-4">
            <p className="font-semibold">{t('rp.confirmTitle')}</p>
            <p className="text-sm text-muted mt-1">{t('rp.confirmText')}</p>
            <div className="grid sm:grid-cols-2 gap-2 mt-3">
              <button className="btn-primary" disabled={busy} onClick={async () => {
                setBusy(true);
                const r = await apiSend(`/api/p/${token}/confirm`, {});
                setBusy(false);
                if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
                router.refresh();
              }}>{t('rp.yes')}</button>
              <button className="btn-outline" disabled={busy || data.paid > 0} onClick={async () => {
                if (!window.confirm(t('rp.noConfirm'))) return;
                setBusy(true);
                const r = await apiSend(`/api/p/${token}/dispute`, {});
                setBusy(false);
                if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
                router.refresh();
              }}>{t('rp.no')}</button>
            </div>
          </div>
        )}
        {data.recorded === 'disputed' && <div className="mt-4"><Alert kind="info">{t('rp.disputed')}</Alert></div>}
        {data.balance <= 0 && data.recorded !== 'disputed' && <div className="mt-4"><Alert kind="ok">{t('my.fullyPaid')}</Alert></div>}
        {data.pendingChange !== null && <div className="mt-4"><Alert kind="info">{t('my.changePending', { amount: fmtMoney(data.pendingChange, data.currency) })}</Alert></div>}
        {msg && <div className="mt-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}

        {data.open && mode === 'none' && data.recorded !== 'disputed' && (
          <div className="grid gap-2 mt-5">
            <button className="btn-accent" onClick={() => { setMode('pay'); setMsg(null); }}>{data.balance > 0 ? t('my.payBalance') : t('my.payMore')}</button>
            <button className="btn-outline" onClick={() => { setMode('change'); setMsg(null); }}>{t('my.change')}</button>
          </div>
        )}

        {mode === 'pay' && (
          <form onSubmit={startPay} className="mt-5 space-y-4">
            <div>
              <label htmlFor="amt" className="label">{t('po.amount')}</label>
              <input id="amt" className="input font-bold" inputMode="numeric" value={withCommas(payAmount)} onChange={(e) => setPayAmount(digits(e.target.value))} />
            </div>
            <PayOptions amount={amt} currency={data.currency} fee={fee} tips={tips} value={pay} onChange={(v) => setPay({ ...pay, ...v })} />
            <button className="btn-accent w-full" disabled={busy}>{busy ? t('a.loading') : t('pf.payBtn', { amount: fmtMoney(q.total, data.currency) })}</button>
            <button type="button" className="btn-ghost w-full" onClick={() => setMode('none')}>{t('a.cancel')}</button>
          </form>
        )}

        {mode === 'change' && (
          <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); action('change', { amount: Number(digits(newAmount)) }, t('my.changed')); }}>
            <label htmlFor="na" className="label">{t('my.newAmount')}</label>
            <input id="na" className="input font-bold" inputMode="numeric" value={withCommas(newAmount)} onChange={(e) => setNewAmount(digits(e.target.value))} />
            <p className="hint">{t('pf.reduceNote')}</p>
            <button className="btn-primary w-full" disabled={busy}>{t('my.changeSubmit')}</button>
            <button type="button" className="btn-ghost w-full" onClick={() => setMode('none')}>{t('a.cancel')}</button>
          </form>
        )}
      </section>

      <section className="card p-6">
        <h2 className="font-bold">{t('my.payments')}</h2>
        {data.payments.length === 0 ? (
          <p className="text-muted mt-2">{t('my.noPayments')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {data.payments.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{fmtMoney(p.amount, data.currency)}</p>
                  <p className="text-xs text-muted">{p.date} · {p.status === 'succeeded' ? t('state.paid') : p.status === 'pending' || p.status === 'created' ? t('pay.checkPhone') : t(p.status === 'refunded' ? 'pay.refunded' : 'state.unpaid')}</p>
                </div>
                {p.receiptNo ? <a className="btn-ghost min-h-[40px] px-3 text-sm" href={`/r/${p.receiptNo}`}>{t('pay.viewReceipt')}</a> : p.status === 'pending' ? <a className="btn-ghost min-h-[40px] px-3 text-sm" href={`/pay/${p.id}`}>{t('a.view')}</a> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-6 space-y-3">
        <h2 className="font-bold">{t('my.privacy')}</h2>
        <a className="btn-outline w-full" href={`/api/p/${token}/export`}>{t('my.export')}</a>
        <button className="btn-ghost w-full text-bad" disabled={busy}
          onClick={() => { if (window.confirm(t('my.deleteConfirm'))) action('delete', {}, t('my.deleted')); }}>
          {t('my.delete')}
        </button>
      </section>

      <Link href={`/e/${data.slug}`} className="btn-ghost w-full">{data.title}</Link>
      <Link href="/help?topic=payment#contact" className="block text-center text-sm text-brand font-semibold">{t('hp.needHelp')}</Link>
    </div>
  );
}
