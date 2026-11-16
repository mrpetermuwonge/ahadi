'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, newIdempotencyKey } from '@/components/client-utils';
import { compressImage, uploadFile } from '@/components/upload';
import { ORGANIZER_KINDS } from '@/lib/eventTypes';

interface Props {
  eventId: string;
  initial: { privacy: string; offsets: string; status: string; tipsEnabled: boolean; showOnHome: boolean; organizerKind: string; showAmounts: boolean };
  homeStatus: 'off' | 'pending' | 'live' | 'declined';
  sombre: boolean;
  plan: { hasPass: boolean; freeMax: number; passPrice: string; credits: number; bundleSize: number; bundlePrice: string };
  verification: { verified: boolean; submitted: { kind: string; status: string }[] } | null;
  phone: string;
}

export function SettingsForm({ eventId, initial, homeStatus, sombre, plan, verification, phone }: Props) {
  const { t } = useT();
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<'mtn' | 'airtel' | 'card'>('mtn');
  const [docKind, setDocKind] = useState<'organizer_id' | 'invoice'>('organizer_id');

  const fail = (code: string) => setMsg({ kind: 'bad', text: t(`err.${code}` as any) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const offsets = s.offsets.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n));
    const r = await apiSend(`/api/events/${eventId}/settings`, { privacy: s.privacy, reminderOffsets: offsets, status: s.status, tipsEnabled: s.tipsEnabled, showOnHome: s.showOnHome, organizerKind: s.organizerKind, showAmounts: s.showAmounts });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    setMsg({ kind: 'ok', text: t('set.saved') });
    router.refresh();
  }

  async function buy(action: 'buy-pass' | 'buy-credits') {
    setBusy(true);
    const r = await apiSend<{ paymentId: string }>(`/api/events/${eventId}/${action}`, { method, phone: method === 'card' ? null : phone, idempotencyKey: newIdempotencyKey() });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    window.location.href = `/pay/${r.data.paymentId}`;
  }

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    const blob = file.type.startsWith('image/') ? await compressImage(file, 1800, 0.8) : file;
    const up = await uploadFile(blob, 'document');
    if (!up.ok) {
      setBusy(false);
      return fail(up.error);
    }
    const r = await apiSend(`/api/events/${eventId}/verification`, { fileId: up.id, kind: docKind });
    setBusy(false);
    if (!r.ok) return fail(r.error);
    setMsg({ kind: 'ok', text: t('set.verifyPending') });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <form onSubmit={save} className="card p-5 space-y-5">
        <h2 className="font-bold">{t('set.title')}</h2>
        <fieldset>
          <legend className="label">{t('set.privacy')}</legend>
          {(['hidden_list', 'public_list'] as const).map((p) => (
            <label key={p} className="flex gap-3 items-start py-2 cursor-pointer">
              <input type="radio" name="privacy" className="mt-1 w-5 h-5" checked={s.privacy === p} onChange={() => setS({ ...s, privacy: p })} />
              <span>{t(p === 'hidden_list' ? 'set.privacyHidden' : 'set.privacyPublic')}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <label className="label" htmlFor="who">{t('who.label')}</label>
          <select id="who" className="input" value={s.organizerKind} onChange={(e) => setS({ ...s, organizerKind: e.target.value })}>
            {ORGANIZER_KINDS.map((k) => <option key={k} value={k}>{t(`who.${k}` as any)}</option>)}
          </select>
        </div>
        <fieldset className="rounded-xl border-2 border-line p-3">
          <legend className="label px-1">{t('set.home')}</legend>
          <label className="flex gap-3 items-start cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={s.showOnHome} onChange={(e) => setS({ ...s, showOnHome: e.target.checked })} />
            <span><span className="font-semibold block">{t('wiz.showHome')}</span><span className="text-sm text-muted">{t('wiz.showHomeHint')}</span></span>
          </label>
          <p className={`text-sm mt-2 font-semibold ${homeStatus === 'live' ? 'text-ok' : homeStatus === 'declined' ? 'text-bad' : 'text-muted'}`}>
            {t(`set.home.${homeStatus}` as any)}
          </p>
        </fieldset>
        <label className="flex gap-3 items-start rounded-xl border-2 border-line p-3 cursor-pointer">
          <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={s.showAmounts} onChange={(e) => setS({ ...s, showAmounts: e.target.checked })} />
          <span><span className="font-semibold block">{t('set.showAmounts')}</span><span className="text-sm text-muted">{t('set.showAmountsHint')}</span></span>
        </label>
        <div>
          <label className="label" htmlFor="offs">{t('set.reminders')}</label>
          <input id="offs" className="input" value={s.offsets} onChange={(e) => setS({ ...s, offsets: e.target.value })} />
          <p className="hint">{t('set.reminderHint')}</p>
        </div>
        {!sombre && (
          <label className="flex gap-3 items-center min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={s.tipsEnabled} onChange={(e) => setS({ ...s, tipsEnabled: e.target.checked })} />
            <span>{t('set.tips')}</span>
          </label>
        )}
        <div>
          <p className="label">{t('set.status')}</p>
          <button type="button" className="btn-outline w-full" onClick={() => setS({ ...s, status: s.status === 'active' ? 'closed' : 'active' })}>
            {s.status === 'active' ? t('set.close') : t('set.reopen')}
          </button>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{t('a.save')}</button>
      </form>

      <section className="card p-5 space-y-3">
        <h2 className="font-bold">{t('set.plan')}</h2>
        <p>{plan.hasPass ? t('set.passActive') : t('set.free', { n: plan.freeMax })}</p>
        <p className="text-sm text-muted">{t('set.credits', { n: plan.credits })}</p>
        <fieldset>
          <legend className="label">{t('set.payWith')}</legend>
          <div className="flex gap-2">
            {(['mtn', 'airtel', 'card'] as const).map((m) => (
              <label key={m} className={`flex-1 text-center rounded-xl border-2 py-2 cursor-pointer text-sm font-semibold ${method === m ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input type="radio" className="sr-only" checked={method === m} onChange={() => setMethod(m)} />
                {t(`pf.${m}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {!plan.hasPass && <button className="btn-accent w-full" disabled={busy} onClick={() => buy('buy-pass')}>{t('set.buyPass', { price: plan.passPrice })}</button>}
        <button className="btn-outline w-full" disabled={busy} onClick={() => buy('buy-credits')}>{t('set.buyCredits', { n: plan.bundleSize, price: plan.bundlePrice })}</button>
      </section>

      {verification && (
        <section className="card p-5 space-y-3">
          <h2 className="font-bold">{t('set.verify')}</h2>
          {verification.verified ? (
            <Alert kind="ok">{t('set.verified')}</Alert>
          ) : (
            <>
              <p className="text-sm text-muted">{t('set.verifyHint')}</p>
              {verification.submitted.map((v, i) => (
                <p key={i} className="text-sm">• {t(v.kind === 'organizer_id' ? 'set.verifyKindId' : 'set.verifyKindInvoice')}: {t(v.status === 'pending' ? 'set.verifyPending' : v.status === 'approved' ? 'set.verifyApproved' : 'set.verifyRejected')}</p>
              ))}
              <div className="flex gap-2">
                {(['organizer_id', 'invoice'] as const).map((k) => (
                  <label key={k} className={`flex-1 text-center rounded-xl border-2 py-2 cursor-pointer text-sm font-semibold ${docKind === k ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                    <input type="radio" className="sr-only" checked={docKind === k} onChange={() => setDocKind(k)} />
                    {t(k === 'organizer_id' ? 'set.verifyKindId' : 'set.verifyKindInvoice')}
                  </label>
                ))}
              </div>
              <label className="btn-outline w-full cursor-pointer">
                {t('set.verifyUpload')}
                <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
              </label>
            </>
          )}
        </section>
      )}
    </div>
  );
}
