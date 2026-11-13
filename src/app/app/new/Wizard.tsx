'use client';
import { useState } from 'react';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { TypeIcon } from '@/components/Brand';
import { apiSend, digits, useDraft, withCommas } from '@/components/client-utils';
import { compressImage, uploadFile } from '@/components/upload';
import { ORGANIZER_KINDS, type FieldDef } from '@/lib/eventTypes';

interface Tpl { type: string; fields: FieldDef[]; urgentAllowed: boolean; requiresVerification: boolean }
interface Draft { type: string; title: string; date: string; target: string; story: string; coverId: string | null; details: Record<string, string>; urgent: boolean; who: string; showOnHome: boolean }

/** 4-step event wizard with progress dots and an autosaved draft. */
export function Wizard({ templates }: { templates: Tpl[] }) {
  const { t } = useT();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [d, setD, clear] = useDraft<Draft>('ahadi:wizard', { type: '', title: '', date: '', target: '', story: '', coverId: null, details: {}, urgent: false, who: 'individual', showOnHome: false });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const tpl = templates.find((x) => x.type === d.type);

  async function onCover(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file, 1280, 0.75);
      const r = await uploadFile(blob, 'cover');
      if (!r.ok) setError(r.error);
      else set({ coverId: r.id });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    const r = await apiSend<{ id: string }>('/api/events', {
      type: d.type, title: d.title, eventDate: d.date || null, targetAmount: d.target ? Number(digits(d.target)) : null,
      story: d.story, coverFileId: d.coverId, details: d.details, urgent: d.urgent,
      organizerKind: d.who, showOnHome: d.showOnHome,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    clear();
    window.location.href = `/app/e/${r.data.id}/share?new=1`;
  }

  const next = () => {
    setError(null);
    if (step === 1 && !d.type) return setError('invalid_type');
    if (step === 2 && d.title.trim().length < 3) return setError('invalid_title');
    if (step < 4) setStep(step + 1);
    else create();
  };

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <button className="btn-ghost px-3 min-h-[44px]" onClick={() => (step > 1 ? setStep(step - 1) : history.back())}>← {t('a.back')}</button>
        <div className="flex gap-2" aria-label={t('wiz.step', { n: step })}>
          {[1, 2, 3, 4].map((n) => <span key={n} className={`h-2 rounded-full transition-all ${n <= step ? 'w-7 bg-brand' : 'w-2 bg-line'}`} />)}
        </div>
        <span className="text-sm text-muted w-16 text-right">{step}/4</span>
      </div>

      <div className="card p-5 mt-3">
        {step === 1 && (
          <>
            <h1 className="text-xl font-bold">{t('wiz.typeTitle')}</h1>
            <div className="grid grid-cols-2 gap-2 mt-4" role="radiogroup">
              {templates.map((x) => (
                <button key={x.type} type="button" role="radio" aria-checked={d.type === x.type}
                  onClick={() => { set({ type: x.type }); setStep(2); }}
                  className={`tap text-left rounded-xl border-2 p-3 min-h-[96px] ${d.type === x.type ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                  <TypeIcon type={x.type} className="w-6 h-6 text-brand" />
                  <span className="block font-semibold mt-1">{t(`type.${x.type}` as any)}</span>
                  <span className="block text-xs text-muted">{t(`type.${x.type}.d` as any)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">{t('wiz.basicsTitle')}</h1>
            <div>
              <label className="label" htmlFor="w-title">{t('wiz.title')}</label>
              <input id="w-title" className="input" maxLength={100} placeholder={t('wiz.titlePh')} value={d.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
            </div>
            <div>
              <label className="label" htmlFor="w-date">{t('wiz.date')}</label>
              <input id="w-date" type="date" className="input" value={d.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <fieldset>
              <legend className="label">{t('who.label')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {ORGANIZER_KINDS.map((k) => (
                  <label key={k} className={`tap cursor-pointer rounded-xl border-2 px-3 py-2 text-sm font-semibold min-h-[48px] flex items-center ${d.who === k ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                    <input type="radio" name="who" className="sr-only" checked={d.who === k} onChange={() => set({ who: k })} />
                    {t(`who.${k}` as any)}
                  </label>
                ))}
              </div>
            </fieldset>
            {tpl?.fields.map((f) => (
              <div key={f.key}>
                <label className="label" htmlFor={`w-${f.key}`}>{t(f.labelKey as any)}</label>
                <input id={`w-${f.key}`} className="input" maxLength={200} value={d.details[f.key] ?? ''} onChange={(e) => set({ details: { ...d.details, [f.key]: e.target.value } })} />
              </div>
            ))}
            {tpl?.urgentAllowed && (
              <label className="flex gap-3 items-center min-h-[44px]">
                <input type="checkbox" className="w-5 h-5" checked={d.urgent} onChange={(e) => set({ urgent: e.target.checked })} />
                <span>{t('wiz.urgent')}</span>
              </label>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">{t('wiz.targetTitle')}</h1>
            <div>
              <label className="label" htmlFor="w-target">{t('wiz.target')}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-semibold">UGX</span>
                <input id="w-target" className="input pl-16 text-lg font-bold" inputMode="numeric" value={withCommas(d.target)} onChange={(e) => set({ target: digits(e.target.value) })} />
              </div>
              <p className="hint">{t('wiz.targetHint')}</p>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h1 className="text-xl font-bold">{t('wiz.storyTitle')}</h1>
            <div>
              <label className="label" htmlFor="w-story">{t('wiz.story')}</label>
              <textarea id="w-story" className="input" rows={5} maxLength={4000} placeholder={t('wiz.storyPh')} value={d.story} onChange={(e) => set({ story: e.target.value })} />
            </div>
            <div>
              {d.coverId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${d.coverId}`} alt="" className="w-full aspect-[16/9] object-cover rounded-xl mb-2" />
              )}
              <label className="btn-outline w-full cursor-pointer">
                {d.coverId ? t('wiz.coverChange') : t('wiz.cover')}
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => onCover(e.target.files?.[0])} />
              </label>
            </div>
            <label className="flex gap-3 items-start rounded-xl border-2 border-line p-3 cursor-pointer">
              <input type="checkbox" className="mt-1 w-5 h-5 shrink-0" checked={d.showOnHome} onChange={(e) => set({ showOnHome: e.target.checked })} />
              <span>
                <span className="font-semibold block">{t('wiz.showHome')}</span>
                <span className="text-sm text-muted">{t('wiz.showHomeHint')}</span>
              </span>
            </label>
            {tpl?.requiresVerification && <Alert kind="info">{t('wiz.sombreNote')}</Alert>}
          </div>
        )}

        {error && <div className="mt-4"><Alert kind="bad">{t(`err.${error}` as any)}</Alert></div>}
        {step > 1 && (
          <button className="btn-primary w-full mt-5" onClick={next} disabled={busy}>
            {busy ? t('a.loading') : step === 4 ? t('wiz.create') : step === 3 && !d.target ? t('a.skip') : t('a.continue')}
          </button>
        )}
        <p className="text-xs text-muted text-center mt-3">{t('wiz.draftSaved')}</p>
      </div>
    </div>
  );
}
