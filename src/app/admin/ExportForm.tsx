'use client';
import { useState } from 'react';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';

/**
 * Choose what to export: sections, dates, event type, phone numbers and format. Files with personal data ask
 * for a fresh code first ("Confirm it's you"), then download.
 */
export function ExportForm({ datasets, analytics, phonesAllowed }: { datasets: string[]; analytics: boolean; phonesAllowed: boolean }) {
  const { t } = useT();
  const [chosen, setChosen] = useState<string[]>([]);
  const [withAnalytics, setWithAnalytics] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [phones, setPhones] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const csvPossible = chosen.length === 1 && !withAnalytics;

  async function download() {
    setBusy(true);
    setMsg(null);
    const body = JSON.stringify({ datasets: chosen, analytics: withAnalytics, from: from || null, to: to || null, type: type || null, phones, format: csvPossible ? format : 'xlsx' });
    const send = () => fetch('/api/admin/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin' });
    let res = await send();
    if (res.status === 401 && window.__ahadiStepUp) {
      const ok = await window.__ahadiStepUp();
      if (!ok) return setBusy(false);
      res = await send();
    }
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return setMsg({ kind: 'bad', text: t(`err.${j.error ?? 'generic'}` as any) });
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'ahadi-export.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg({ kind: 'ok', text: t('xp.done', { name }) });
  }

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="font-bold">{t('xp.what')}</h2>
        <p className="text-sm text-muted">{t('xp.whatHint')}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
          {datasets.map((k) => (
            <label key={k} className={`tap cursor-pointer rounded-xl border-2 p-3 flex gap-3 items-start ${chosen.includes(k) ? 'border-brand bg-brand-soft' : 'border-line'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={chosen.includes(k)} onChange={() => toggle(k)} />
              <span><span className="font-semibold block">{t(`xp.ds.${k}` as any)}</span><span className="text-xs text-muted">{t(`xp.ds.${k}.d` as any)}</span></span>
            </label>
          ))}
          {analytics && (
            <label className={`tap cursor-pointer rounded-xl border-2 p-3 flex gap-3 items-start ${withAnalytics ? 'border-brand bg-brand-soft' : 'border-line'}`}>
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={withAnalytics} onChange={(e) => setWithAnalytics(e.target.checked)} />
              <span><span className="font-semibold block">{t('xp.ds.analytics')}</span><span className="text-xs text-muted">{t('xp.ds.analytics.d')}</span></span>
            </label>
          )}
        </div>
      </section>
      <section className="card p-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div><label className="label" htmlFor="xp-from">{t('xp.from')}</label><input id="xp-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label" htmlFor="xp-to">{t('xp.to')}</label><input id="xp-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="xp-type">{t('ledger.type')}</label>
          <select id="xp-type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t('xp.allTypes')}</option>
            {['wedding', 'birthday', 'hospital', 'funeral', 'community', 'other'].map((x) => <option key={x} value={x}>{t(`type.${x}` as any)}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="xp-format">{t('xp.format')}</label>
          <select id="xp-format" className="input" value={csvPossible ? format : 'xlsx'} disabled={!csvPossible} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv')}>
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="csv">CSV</option>
          </select>
          {!csvPossible && <p className="hint">{t('xp.csvOne')}</p>}
        </div>
        {phonesAllowed && (
          <label className="sm:col-span-2 lg:col-span-4 flex gap-3 items-start cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={phones} onChange={(e) => setPhones(e.target.checked)} />
            <span><span className="font-semibold block">{t('xp.phones')}</span><span className="text-sm text-muted">{t('xp.phonesHint')}</span></span>
          </label>
        )}
      </section>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button type="button" className="btn-primary" disabled={busy || (chosen.length === 0 && !withAnalytics)} onClick={download}>
        {busy ? t('a.loading') : t('xp.download')}
      </button>
      <p className="text-xs text-muted">{t('xp.note')}</p>
    </div>
  );
}
