'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, digits, withCommas } from '@/components/client-utils';

export function PayoutForm({ eventId, currency, max, accounts }: { eventId: string; currency: string; max: number; accounts: { id: string; label: string }[] }) {
  const { t } = useT();
  const router = useRouter();
  const [amount, setAmount] = useState(String(max));
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await apiSend(`/api/events/${eventId}/request-payout`, { accountId, amount: Number(digits(amount)) });
        setBusy(false);
        if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
        setMsg({ kind: 'ok', text: t('po.requested') });
        router.refresh();
      }}
    >
      <h2 className="font-bold">{t('po.title')}</h2>
      <div>
        <label className="label" htmlFor="po-a">{t('po.amount')} ({currency})</label>
        <input id="po-a" className="input font-bold" inputMode="numeric" value={withCommas(amount)} onChange={(e) => setAmount(digits(e.target.value))} />
      </div>
      <div>
        <label className="label" htmlFor="po-acc">{t('po.account')}</label>
        <select id="po-acc" className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary w-full" disabled={busy || !accountId}>{busy ? t('a.loading') : t('po.request')}</button>
    </form>
  );
}
