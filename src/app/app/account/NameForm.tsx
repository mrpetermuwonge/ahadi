'use client';
import { useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

/** One field: the name people see on your badge and as "Organised by" on your pledge cards. */
export function NameForm({ initial, compact = false }: { initial: string; compact?: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiSend('/api/account/name', { name });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
    setMsg({ kind: 'ok', text: t('acct.saved') });
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div>
        <label className="label" htmlFor="acct-name">{t('acct.name')}</label>
        <div className={compact ? 'flex gap-2' : ''}>
          <input id="acct-name" className="input" maxLength={60} autoComplete="name" placeholder={t('acct.namePh')} value={name} onChange={(e) => { setName(e.target.value); setMsg(null); }} />
          {compact && <button className="btn-primary shrink-0 px-5" disabled={busy}>{t('a.save')}</button>}
        </div>
        {!compact && <p className="hint">{t('acct.nameHint')}</p>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {!compact && <button className="btn-primary w-full" disabled={busy}>{busy ? t('a.loading') : t('a.save')}</button>}
    </form>
  );
}
