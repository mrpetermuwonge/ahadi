'use client';
import { useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, digits, useDraft, withCommas } from '@/components/client-utils';

export function ManualEntry({ eventId, currency, pledges }: { eventId: string; currency: string; pledges: { id: string; name: string }[] }) {
  const { t } = useT();
  const router = useRouter();
  const [d, setD, clear] = useDraft(`ahadi:manual:${eventId}`, { pledgeId: '', amount: '', reason: '', receipt: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (pledges.length === 0) return null;
  return (
    <form
      className="card p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await apiSend(`/api/events/${eventId}/manual-payment`, { pledgeId: d.pledgeId, amount: Number(digits(d.amount)), reason: d.reason, receipt: d.receipt });
        setBusy(false);
        if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
        clear();
        setD({ pledgeId: '', amount: '', reason: '', receipt: '' });
        setMsg({ kind: 'ok', text: t('ledger.recorded') });
        startTransition(() => router.refresh());
      }}
    >
      <h2 className="font-bold">{t('ledger.manual')}</h2>
      <div>
        <label className="label" htmlFor="m-p">{t('ledger.pledger')}</label>
        <select id="m-p" className="input" required value={d.pledgeId} onChange={(e) => setD({ ...d, pledgeId: e.target.value })}>
          <option value="">{t('ledger.choose')}</option>
          {pledges.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="m-a">{t('ledger.amount')} ({currency})</label>
        <input id="m-a" className="input font-bold" inputMode="numeric" required value={withCommas(d.amount)} onChange={(e) => setD({ ...d, amount: digits(e.target.value) })} />
      </div>
      <div>
        <label className="label" htmlFor="m-r">{t('ledger.reason')}</label>
        <input id="m-r" className="input" required minLength={3} maxLength={200} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="m-n">{t('ledger.receipt')}</label>
        <input id="m-n" className="input" maxLength={60} value={d.receipt} onChange={(e) => setD({ ...d, receipt: e.target.value })} />
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? t('a.loading') : t('ledger.record')}</button>
    </form>
  );
}
