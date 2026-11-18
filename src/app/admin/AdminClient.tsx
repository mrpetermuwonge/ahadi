'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';
import { compressImage, uploadFile } from '@/components/upload';

/** One admin action. Sensitive ones ask for a fresh code first (handled by apiSend + the "Confirm it's you" dialog). */
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
          if (action === 'payout-review' || action === 'verification' || action === 'refund') {
            const n = window.prompt(t('ledger.reason'));
            if (n === null) return;
            note = n;
          }
          setBusy(true);
          setError(null);
          const r = await apiSend(`/api/admin/${action}`, { ...(body as object), note });
          setBusy(false);
          if (!r.ok) setError(r.error);
          else router.refresh();
        }}>
        {busy ? t('a.loading') : label}
      </button>
      {error && error !== 'step_up_cancelled' && <span role="alert" className="text-xs text-bad">{t(`err.${error}` as any)}</span>}
    </span>
  );
}

/**
 * Edit fees, prices, limits and feature flags without a deploy. Money settings (marked) need a second super admin
 * to approve when there is more than one super admin.
 */
export function SettingsEditor({ values, keys, moneyKeys }: { values: Record<string, unknown>; keys: string[]; moneyKeys: string[] }) {
  const { t } = useT();
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, typeof values[k] === 'object' ? JSON.stringify(values[k]) : String(values[k])])));
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="card p-5" onSubmit={async (e) => {
      e.preventDefault();
      const out: Record<string, unknown> = {};
      try {
        for (const k of keys) {
          const orig = values[k];
          out[k] = typeof orig === 'number' ? Number(v[k]) : typeof orig === 'boolean' ? v[k] === 'true' : JSON.parse(v[k] || 'null');
        }
      } catch {
        return setMsg({ kind: 'bad', text: t('err.invalid_input') });
      }
      setBusy(true);
      const r = await apiSend<{ applied: string[]; proposed: string[] }>('/api/admin/settings', { values: out });
      setBusy(false);
      if (!r.ok) return r.error === 'step_up_cancelled' ? undefined : setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      const parts = [];
      if (r.data.applied.length) parts.push(t('ax.applied', { k: r.data.applied.join(', ') }));
      if (r.data.proposed.length) parts.push(t('ax.proposed', { k: r.data.proposed.join(', ') }));
      setMsg({ kind: r.data.proposed.length ? 'info' : 'ok', text: parts.join(' ') || t('ax.noChanges') });
      router.refresh();
    }}>
      <h2 className="font-bold">{t('adm.settings')}</h2>
      <p className="text-sm text-muted">{t('ax.settingsHint')}</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        {keys.map((k) => (
          <div key={k}>
            <label className="label font-mono text-xs flex items-center gap-1" htmlFor={`s-${k}`}>
              {k}{moneyKeys.includes(k) && <span className="chip bg-accent/25 text-ink text-[10px]">{t('ax.twoPerson')}</span>}
            </label>
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
      <button className="btn-primary mt-4" disabled={busy}>{busy ? t('a.loading') : t('a.save')}</button>
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

/** Add a staff member, change their admin role, or remove them (super admins only). */
export function TeamForm() {
  const { t } = useT();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'super' | 'finance' | 'trust' | 'support' | 'none'>('support');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="card p-5 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      const r = await apiSend('/api/admin/team-set', { phone, role: role === 'none' ? null : role });
      setBusy(false);
      if (!r.ok) return r.error === 'step_up_cancelled' ? undefined : setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      setMsg({ kind: 'ok', text: t('ax.teamSaved') });
      setPhone('');
      router.refresh();
    }}>
      <h2 className="font-bold">{t('ax.teamManage')}</h2>
      <p className="text-sm text-muted">{t('ax.teamHint')}</p>
      <div>
        <label className="label" htmlFor="team-phone">{t('acct.phone')}</label>
        <input id="team-phone" className="input" inputMode="tel" placeholder="0772 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="team-role">{t('ax.adminRole')}</label>
        <select id="team-role" className="input" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {(['support', 'trust', 'finance', 'super'] as const).map((r) => <option key={r} value={r}>{t(`ax.role.${r}` as any)}</option>)}
          <option value="none">{t('ax.removeAdmin')}</option>
        </select>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary" disabled={busy || phone.length < 9}>{busy ? t('a.loading') : t('a.save')}</button>
    </form>
  );
}

/** Account recovery: a new phone number becomes the organizer after Ahadi checked their identity (super admins). */
export function ReassignOwner({ eventId }: { eventId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="btn-outline min-h-[36px] px-3 text-xs" onClick={() => setOpen(true)}>{t('ax.recover')}</button>;
  return (
    <div className="mt-2 text-left rounded-xl border-2 border-accent/60 bg-accent-soft/40 p-3 space-y-2 min-w-[260px]">
      <p className="text-xs font-semibold">{t('ax.recoverHint')}</p>
      <input className="input" inputMode="tel" placeholder={t('ax.newOrganizerPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={t('ax.newOrganizerPhone')} />
      <textarea className="input" rows={2} placeholder={t('ax.recoverReason')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('ax.recoverReason')} />
      {error && error !== 'step_up_cancelled' && <p role="alert" className="text-xs text-bad">{t(`err.${error}` as any)}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary min-h-[36px] px-3 text-xs" disabled={busy} onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await apiSend('/api/admin/reassign-owner', { eventId, phone, reason });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          setOpen(false);
          router.refresh();
        }}>{busy ? t('a.loading') : t('ax.recoverConfirm')}</button>
        <button type="button" className="btn-ghost min-h-[36px] px-3 text-xs" onClick={() => setOpen(false)}>{t('a.cancel')}</button>
      </div>
    </div>
  );
}

/** Erase a pledger's personal data after a request to Ahadi (Trust & safety or Super admin). */
export function EraseForm() {
  const { t } = useT();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="card p-5 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!window.confirm(t('ax.eraseConfirm', { phone }))) return;
      setBusy(true);
      setMsg(null);
      const r = await apiSend('/api/admin/erase-pledger', { phone });
      setBusy(false);
      if (!r.ok) return r.error === 'step_up_cancelled' ? undefined : setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      setMsg({ kind: 'ok', text: t('ax.erased') });
      setPhone('');
      router.refresh();
    }}>
      <h2 className="font-bold">{t('ax.eraseTitle')}</h2>
      <p className="text-sm text-muted">{t('ax.eraseHint')}</p>
      <div>
        <label className="label" htmlFor="erase-phone">{t('acct.phone')}</label>
        <input id="erase-phone" className="input" inputMode="tel" placeholder="0772 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-outline text-bad" disabled={busy || phone.length < 9}>{busy ? t('a.loading') : t('ax.eraseButton')}</button>
    </form>
  );
}

/** Run a backup or the data clean-up now (Super admin). */
export function OpsButton({ action, label }: { action: 'backup-now' | 'retention-now'; label: string }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" className="btn-outline min-h-[40px] px-3 text-sm" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await apiSend(`/api/admin/${action}`, {});
        setBusy(false);
        setRes(r.ok ? JSON.stringify(r.data) : t(`err.${r.error}` as any));
        router.refresh();
      }}>{busy ? t('a.loading') : label}</button>
      {res && <span className="text-xs text-muted break-all max-w-md">{res}</span>}
    </span>
  );
}

/** Super admin controls for one account: rename, sign out everywhere, suspend (optionally freezing their events) or reactivate. */
export function AccountActions({ userId, name, suspended }: { userId: string; name: string; suspended: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [newName, setNewName] = useState(name);
  const [reason, setReason] = useState('');
  const [freeze, setFreeze] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const run = async (action: string, body: object, ok: string) => {
    setBusy(true);
    setMsg(null);
    const r = await apiSend(`/api/admin/${action}`, { userId, ...body });
    setBusy(false);
    if (!r.ok) return r.error === 'step_up_cancelled' ? undefined : setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
    setMsg({ kind: 'ok', text: ok });
    router.refresh();
  };
  return (
    <section className="card p-5 space-y-4">
      <h3 className="font-bold">{t('ac.manage')}</h3>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label" htmlFor="ac-name">{t('acct.name')}</label>
          <input id="ac-name" className="input" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <button type="button" className="btn-outline" disabled={busy || newName.trim() === name} onClick={() => run('account-rename', { name: newName }, t('ac.renamed'))}>{t('a.save')}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-outline" disabled={busy} onClick={() => run('account-signout', {}, t('ac.signedOut'))}>{t('ac.signOut')}</button>
        {suspended && <button type="button" className="btn-primary" disabled={busy} onClick={() => run('account-reactivate', {}, t('ac.reactivated'))}>{t('ac.reactivate')}</button>}
      </div>
      {!suspended && (
        <div className="rounded-xl border-2 border-bad/30 p-3 space-y-2">
          <p className="font-semibold text-bad">{t('ac.suspend')}</p>
          <p className="text-xs text-muted">{t('ac.suspendHint')}</p>
          <textarea className="input" rows={2} placeholder={t('ac.reason')} aria-label={t('ac.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="flex gap-2 items-center text-sm cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={freeze} onChange={(e) => setFreeze(e.target.checked)} />{t('ac.freezeToo')}
          </label>
          <button type="button" className="btn-outline text-bad" disabled={busy || reason.trim().length < 10}
            onClick={() => window.confirm(t('ac.suspendConfirm')) && run('account-suspend', { reason, freezeEvents: freeze }, t('ac.suspendedDone'))}>{t('ac.suspend')}</button>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </section>
  );
}

/** Add a partner to the homepage strip: name, short line, website and an optional logo. */
export function PartnerForm() {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [url, setUrl] = useState('');
  const [logoId, setLogoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  return (
    <form className="card p-5 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      const r = await apiSend('/api/admin/partner-add', { name, tagline: tagline || null, url: url || null, logoFileId: logoId });
      setBusy(false);
      if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      setName(''); setTagline(''); setUrl(''); setLogoId(null);
      setMsg({ kind: 'ok', text: t('pt.added') });
      router.refresh();
    }}>
      <h3 className="font-bold">{t('pt.add')}</h3>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="label" htmlFor="pt-name">{t('pt.name')}</label><input id="pt-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label" htmlFor="pt-tag">{t('pt.tagline')}</label><input id="pt-tag" className="input" maxLength={60} value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
        <div><label className="label" htmlFor="pt-url">{t('pt.url')}</label><input id="pt-url" className="input" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
      </div>
      <div className="flex items-center gap-3">
        {logoId && <img src={`/api/files/${logoId}`} alt="" className="w-12 h-12 rounded-lg object-contain border border-line bg-white" />}
        <label className="btn-outline cursor-pointer">
          {logoId ? t('wiz.coverChange') : t('pt.logo')}
          <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            const up = await uploadFile(await compressImage(f, 400, 0.85), 'cover');
            setBusy(false);
            if (!up.ok) setMsg({ kind: 'bad', text: t(`err.${up.error}` as any) });
            else setLogoId(up.id);
          }} />
        </label>
        <span className="text-xs text-muted">{t('pt.logoHint')}</span>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary" disabled={busy || name.trim().length < 2}>{busy ? t('a.loading') : t('pt.addButton')}</button>
    </form>
  );
}
