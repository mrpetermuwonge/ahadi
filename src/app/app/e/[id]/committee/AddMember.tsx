'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

export function AddMember({ eventId }: { eventId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'treasurer' | 'viewer' | 'owner'>('treasurer');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card p-5 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await apiSend(`/api/events/${eventId}/add-member`, { phone, role });
        setBusy(false);
        if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
        setPhone('');
        setMsg({ kind: 'ok', text: t('com.added') });
        router.refresh();
      }}
    >
      <h2 className="font-bold">{t('com.add')}</h2>
      <div>
        <label className="label" htmlFor="c-phone">{t('com.phone')}</label>
        <input id="c-phone" className="input" inputMode="tel" placeholder="0772 123 456" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <fieldset>
        <legend className="label">{t('com.role')}</legend>
        <div className="grid gap-2">
          {(['treasurer', 'viewer', 'owner'] as const).map((r) => (
            <label key={r} className={`flex items-start gap-3 rounded-xl border-2 p-3 cursor-pointer ${role === r ? 'border-brand bg-brand-soft' : 'border-line'}`}>
              <input type="radio" name="role" className="mt-1 w-5 h-5" checked={role === r} onChange={() => setRole(r)} />
              <span><span className="font-semibold block">{t(`role.${r}`)}</span><span className="text-sm text-muted">{t(`role.${r}.d`)}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? t('a.loading') : t('com.add')}</button>
    </form>
  );
}
