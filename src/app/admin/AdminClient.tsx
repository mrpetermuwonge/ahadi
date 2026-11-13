'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

export function AdminButton({ action, body, label, primary }: { action: string; body: unknown; label: string; primary?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button className={`${primary ? 'btn-primary' : 'btn-outline'} min-h-[36px] px-3 text-xs`} disabled={busy}
        onClick={async () => {
          let note = '';
          if (action === 'payout-review' || action === 'verification') note = window.prompt(t('ledger.reason')) ?? '';
          setBusy(true);
          const r = await apiSend(`/api/admin/${action}`, { ...(body as object), note });
          setBusy(false);
          if (!r.ok) setError(r.error);
          else router.refresh();
        }}>
        {busy ? t('a.loading') : label}
      </button>
      {error && <span role="alert" className="text-xs text-bad">{t(`err.${error}` as any)}</span>}
    </span>
  );
}

/** Edit fees, prices, limits and feature flags without a deploy. Changes apply on the next request. */
export function SettingsEditor({ values, keys }: { values: Record<string, unknown>; keys: string[] }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, typeof values[k] === 'object' ? JSON.stringify(values[k]) : String(values[k])])));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  return (
    <form className="card p-5" onSubmit={async (e) => {
      e.preventDefault();
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        const orig = values[k];
        out[k] = typeof orig === 'number' ? Number(v[k]) : typeof orig === 'boolean' ? v[k] === 'true' : JSON.parse(v[k] || 'null');
      }
      const r = await apiSend('/api/admin/settings', { values: out });
      if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      setMsg({ kind: 'ok', text: t('adm.saved') });
      router.refresh();
    }}>
      <h2 className="font-bold">{t('adm.settings')}</h2>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        {keys.map((k) => (
          <div key={k}>
            <label className="label font-mono text-xs" htmlFor={`s-${k}`}>{k}</label>
            {typeof values[k] === 'boolean' ? (
              <select id={`s-${k}`} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })}>
                <option value="true">true</option><option value="false">false</option>
              </select>
            ) : (
              <input id={`s-${k}`} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {msg && <div className="mt-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button className="btn-primary mt-4">{t('a.save')}</button>
    </form>
  );
}

export function RunJobs() {
  const { t } = useT();
  const router = useRouter();
  const [res, setRes] = useState<string | null>(null);
  return (
    <div className="card p-5">
      <button className="btn-outline" onClick={async () => {
        const r = await apiSend('/api/admin/run-jobs', {});
        setRes(r.ok ? JSON.stringify(r.data) : r.error);
        router.refresh();
      }}>{t('adm.runJobs')}</button>
      {res && <p className="text-xs mt-2 break-all">{t('adm.jobsDone', { r: res })}</p>}
    </div>
  );
}
