'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, digits, withCommas } from '@/components/client-utils';
import { compressImage, uploadFile } from '@/components/upload';
import type { FieldDef } from '@/lib/eventTypes';

interface Initial { title: string; date: string; target: string; story: string; coverId: string | null; details: Record<string, string> }

/**
 * Edit the event after it is created: title, date, place details, target, story and cover photo.
 * The event link stays the same, so links, QR codes and pledge cards already shared keep working.
 */
export function EventDetailsForm({ eventId, initial, fields, currency, verified }: { eventId: string; initial: Initial; fields: FieldDef[]; currency: string; verified: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const set = (p: Partial<Initial>) => {
    setD((x) => ({ ...x, ...p }));
    setMsg(null);
  };

  async function onCover(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await uploadFile(await compressImage(file, 1280, 0.75), 'cover');
      if (!r.ok) setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
      else set({ coverId: r.id });
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (d.title.trim().length < 3) return setMsg({ kind: 'bad', text: t('err.invalid_title') });
    setBusy(true);
    const r = await apiSend(`/api/events/${eventId}/details`, {
      title: d.title, eventDate: d.date || null, targetAmount: d.target ? Number(digits(d.target)) : null,
      story: d.story, coverFileId: d.coverId, details: d.details,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
    setMsg({ kind: 'ok', text: t('edit.saved') });
    router.refresh();
  }

  return (
    <form onSubmit={save} className="card p-5 space-y-4">
      <div>
        <h2 className="font-bold">{t('edit.title')}</h2>
        <p className="text-sm text-muted mt-1">{t('edit.hint')}</p>
      </div>
      {verified && <Alert kind="info">{t('edit.verifiedNote')}</Alert>}
      <div>
        {d.coverId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${d.coverId}`} alt="" className="w-full aspect-[16/9] object-cover rounded-xl mb-2 bg-brand-soft" />
        )}
        <label className="btn-outline w-full cursor-pointer">
          {d.coverId ? t('wiz.coverChange') : t('wiz.cover')}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => onCover(e.target.files?.[0])} />
        </label>
      </div>
      <div>
        <label className="label" htmlFor="ed-title">{t('wiz.title')}</label>
        <input id="ed-title" className="input" maxLength={100} value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="ed-date">{t('wiz.date')}</label>
        <input id="ed-date" type="date" className="input" value={d.date} onChange={(e) => set({ date: e.target.value })} />
      </div>
      {fields.map((f) => (
        <div key={f.key}>
          <label className="label" htmlFor={`ed-${f.key}`}>{t(f.labelKey as any)}</label>
          <input id={`ed-${f.key}`} className="input" maxLength={200} value={d.details[f.key] ?? ''} onChange={(e) => set({ details: { ...d.details, [f.key]: e.target.value } })} />
        </div>
      ))}
      <div>
        <label className="label" htmlFor="ed-target">{t('wiz.target')}</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-semibold">{currency}</span>
          <input id="ed-target" className="input pl-16 font-bold" inputMode="numeric" value={withCommas(d.target)} onChange={(e) => set({ target: digits(e.target.value) })} />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="ed-story">{t('wiz.story')}</label>
        <textarea id="ed-story" className="input" rows={5} maxLength={4000} value={d.story} onChange={(e) => set({ story: e.target.value })} />
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? t('a.loading') : t('edit.save')}</button>
    </form>
  );
}
