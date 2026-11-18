'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend, digits, fmtMoney, withCommas } from '@/components/client-utils';
import { compressImage, uploadFile } from '@/components/upload';
import { tidyPhone } from '@/lib/phone';

type Msg = { kind: 'ok' | 'bad' | 'info'; text: string } | null;
type Result = { added: number; duplicates: string[]; errors: { row: number; error: string }[] };

/** Record a pledge made at a meeting, or upload a whole list (Excel/CSV). Each person is asked to confirm. */
export function RecordPledges({ eventId, currency, canRecordCash }: { eventId: string; currency: string; canRecordCash: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState<'one' | 'list' | null>(null);
  const empty = { name: '', phone: '', amount: '', due: '', paidMode: 'none' as 'none' | 'full' | 'part', paid: '', via: 'cash' as 'cash' | 'bank' | 'mobile_money' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: { name: string; phone: string; amount: number; dueDate: string | null; paid?: number }[]; errors: { row: number; error: string }[]; total: number; paid: number } | null>(null);
  const amountNum = Number(digits(f.amount)) || 0;
  const paidNum = f.paidMode === 'full' ? amountNum : f.paidMode === 'part' ? Number(digits(f.paid)) || 0 : 0;

  const summary = (r: Result) => [
    t('rp.added', { n: r.added }),
    r.duplicates.length ? t('rp.dups', { n: r.duplicates.length }) : '',
    r.errors.length ? t('rp.errors', { n: r.errors.length }) : '',
  ].filter(Boolean).join(' ');

  async function addOne(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (f.paidMode === 'part' && (paidNum <= 0 || paidNum >= amountNum)) { setBusy(false); return setMsg({ kind: 'bad', text: t('rp.partHint') }); }
    const r = await apiSend<Result>(`/api/events/${eventId}/record-pledge`, {
      name: f.name, phone: tidyPhone(f.phone), amount: amountNum, dueDate: f.due || null,
      ...(paidNum > 0 ? { paid: paidNum, paidVia: f.via } : {}),
    });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
    if (r.data.errors.length) return setMsg({ kind: 'bad', text: t(`err.${r.data.errors[0]!.error}` as any) });
    if (r.data.duplicates.length) return setMsg({ kind: 'info', text: t('rp.dupOne') });
    setMsg({ kind: 'ok', text: paidNum > 0 ? t('rp.addedOnePaid', { name: f.name, paid: fmtMoney(paidNum, currency) }) : t('rp.addedOne', { name: f.name }) });
    setF(empty);
    router.refresh();
  }

  async function upload(previewOnly: boolean) {
    if (!file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/events/${eventId}/import${previewOnly ? '?preview=1' : ''}`, { method: 'POST', body: fd, credentials: 'same-origin' });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ kind: 'bad', text: t(`err.${j.error ?? 'generic'}` as any) });
    if (previewOnly) return setPreview(j);
    setPreview(null); setFile(null);
    setMsg({ kind: j.errors?.length ? 'info' : 'ok', text: summary(j) });
    router.refresh();
  }

  function template() {
    const csv = 'Name,Phone,Amount,Due date,Paid\nJane Namuli,0772123456,100000,,\nJohn Okello,0701234567,50000,2026-12-20,20000\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'ahadi-pledges-template.csv';
    a.click();
  }

  return (
    <section className="card p-5">
      <h2 className="font-bold">{t('rp.title')}</h2>
      <p className="text-sm text-muted mt-1">{t('rp.hint')}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={open === 'one' ? 'btn-primary min-h-[40px] px-3 text-sm' : 'btn-outline min-h-[40px] px-3 text-sm'} onClick={() => { setOpen(open === 'one' ? null : 'one'); setMsg(null); }}>{t('rp.addOne')}</button>
        <button type="button" className={open === 'list' ? 'btn-primary min-h-[40px] px-3 text-sm' : 'btn-outline min-h-[40px] px-3 text-sm'} onClick={() => { setOpen(open === 'list' ? null : 'list'); setMsg(null); }}>{t('rp.uploadList')}</button>
      </div>
      {open === 'one' && (
        <form onSubmit={addOne} className="grid sm:grid-cols-2 gap-3 mt-4">
          <div><label className="label" htmlFor="rp-name">{t('pf.name')}</label><input id="rp-name" className="input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div><label className="label" htmlFor="rp-phone">{t('pf.phone')}</label><input id="rp-phone" className="input" inputMode="tel" placeholder="0772 123 456" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} onBlur={(e) => setF({ ...f, phone: tidyPhone(e.target.value) })} required /></div>
          <div>
            <label className="label" htmlFor="rp-amount">{t('pf.howMuch')}</label>
            <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-semibold">{currency}</span>
              <input id="rp-amount" className="input pl-16 font-bold" inputMode="numeric" value={withCommas(f.amount)} onChange={(e) => setF({ ...f, amount: digits(e.target.value) })} required /></div>
          </div>
          {f.paidMode !== 'full' && <div><label className="label" htmlFor="rp-due">{t('pf.dueDate')}</label><input id="rp-due" type="date" className="input" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /><p className="hint">{t('rp.dueHint')}</p></div>}
          <fieldset className="sm:col-span-2 rounded-xl border border-line p-3">
            <legend className="label px-1">{t('rp.paidQ')}</legend>
            {canRecordCash ? (
              <>
                <div className="grid grid-cols-3 gap-2" role="radiogroup">
                  {(['none', 'full', 'part'] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={f.paidMode === m}
                      className={`${f.paidMode === m ? 'btn-primary' : 'btn-outline'} min-h-[40px] px-2 text-sm`}
                      onClick={() => setF({ ...f, paidMode: m })}>{t(`rp.paid.${m}` as any)}</button>
                  ))}
                </div>
                {f.paidMode !== 'none' && (
                  <div className="grid sm:grid-cols-2 gap-3 mt-3">
                    {f.paidMode === 'part' && (
                      <div>
                        <label className="label" htmlFor="rp-paid">{t('rp.paidAmount')}</label>
                        <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-semibold">{currency}</span>
                          <input id="rp-paid" className="input pl-16 font-bold" inputMode="numeric" value={withCommas(f.paid)} onChange={(e) => setF({ ...f, paid: digits(e.target.value) })} required /></div>
                      </div>
                    )}
                    <div>
                      <label className="label" htmlFor="rp-via">{t('rp.via')}</label>
                      <select id="rp-via" className="input" value={f.via} onChange={(e) => setF({ ...f, via: e.target.value as typeof f.via })}>
                        <option value="cash">{t('rp.via.cash')}</option>
                        <option value="mobile_money">{t('rp.via.mobile_money')}</option>
                        <option value="bank">{t('rp.via.bank')}</option>
                      </select>
                    </div>
                    <p className="sm:col-span-2 text-xs rounded-lg bg-accent-soft/60 p-2">{t('rp.offlineNote', { paid: fmtMoney(paidNum, currency) })}</p>
                  </div>
                )}
              </>
            ) : <p className="text-sm text-muted">{t('rp.cashTreasurerOnly')}</p>}
          </fieldset>
          <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? t('a.loading') : t('rp.save')}</button></div>
        </form>
      )}
      {open === 'list' && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">{t('rp.listHint')} <button type="button" className="text-brand font-semibold underline" onClick={template}>{t('rp.template')}</button></p>
          <input type="file" accept=".xlsx,.csv" className="block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setMsg(null); }} />
          {file && !preview && <button type="button" className="btn-outline" disabled={busy} onClick={() => upload(true)}>{busy ? t('a.loading') : t('rp.check')}</button>}
          {preview && (
            <div className="rounded-xl border border-line p-3">
              <p className="font-semibold">{t('rp.previewTitle', { n: preview.rows.length, total: fmtMoney(preview.total, currency) })}</p>
              {preview.paid > 0 && <p className="text-sm mt-1">{t('rp.previewPaid', { paid: fmtMoney(preview.paid, currency) })}</p>}
              {preview.paid > 0 && !canRecordCash && <p className="text-sm text-bad mt-1">{t('rp.cashTreasurerOnly')}</p>}
              {preview.errors.length > 0 && <p className="text-sm text-bad mt-1">{t('rp.previewErrors', { rows: preview.errors.map((x) => x.row).join(', ') })}</p>}
              <div className="max-h-56 overflow-auto mt-2">
                <table className="w-full text-sm"><tbody>{preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-line"><td className="py-1 pr-2">{r.name}</td><td className="pr-2">{r.phone}</td><td className="text-right pr-2">{fmtMoney(r.amount, currency)}</td><td className="text-right pr-2 text-ok">{r.paid ? fmtMoney(r.paid, currency) : ''}</td><td className="text-muted">{r.dueDate ?? ''}</td></tr>
                ))}</tbody></table>
                {preview.rows.length > 50 && <p className="text-xs text-muted mt-1">{t('rp.more', { n: preview.rows.length - 50 })}</p>}
              </div>
              <div className="flex gap-2 mt-3">
                <button type="button" className="btn-primary" disabled={busy || preview.rows.length === 0} onClick={() => upload(false)}>{busy ? t('a.loading') : t('rp.import', { n: preview.rows.length })}</button>
                <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>{t('a.cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
    </section>
  );
}

/** "Remind everyone who still owes": one message to each pledger with a balance (at most once a day). */
export function RemindOwing({ eventId, currency, count, total, lastAt, nextAt }: { eventId: string; currency: string; count: number; total: number; lastAt: string | null; nextAt: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <section className="card p-5">
      <h2 className="font-bold">{t('nd.title')}</h2>
      <p className="text-sm text-muted mt-1">{count > 0 ? t('nd.owing', { n: count, total: fmtMoney(total, currency) }) : t('nd.none')}</p>
      {lastAt && <p className="text-xs text-muted mt-1">{t('nd.last', { d: fmt(lastAt) })}</p>}
      {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      <button type="button" className="btn-accent mt-3" disabled={busy || count === 0 || !!nextAt} onClick={async () => {
        if (!window.confirm(t('nd.confirm', { n: count }))) return;
        setBusy(true); setMsg(null);
        const r = await apiSend<{ owing: number; sent: number }>(`/api/events/${eventId}/remind-owing`, {});
        setBusy(false);
        if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
        setMsg({ kind: 'ok', text: t('nd.sent', { n: r.data.sent }) });
        router.refresh();
      }}>{busy ? t('a.loading') : t('nd.button', { n: count })}</button>
      {nextAt && <p className="text-xs text-muted mt-2">{t('nd.next', { d: fmt(nextAt) })}</p>}
    </section>
  );
}

/** Post news to supporters (with an optional picture) and remove your own posts. */
export function UpdatesPanel({ eventId, updates, canPost, staffHide = false }: {
  eventId: string; canPost: boolean; staffHide?: boolean;
  updates: { id: string; body: string; image_file_id: string | null; notified: number; created_at: string; hidden_at: string | null }[];
}) {
  const { t } = useT();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [notifyAll, setNotifyAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <section className="card p-5" id="updates">
      <h2 className="font-bold">{t('up.title')}</h2>
      <p className="text-sm text-muted mt-1">{t('up.hint')}</p>
      {canPost && (
        <div className="mt-3 space-y-2">
          <textarea className="input" rows={3} maxLength={1500} placeholder={t('up.placeholder')} aria-label={t('up.title')} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            {image && <img src={`/api/files/${image}`} alt="" className="w-16 h-12 rounded-md object-cover" />}
            <label className="btn-outline min-h-[40px] px-3 text-sm cursor-pointer">
              {image ? t('wiz.coverChange') : t('up.addPhoto')}
              <input type="file" accept="image/*" className="sr-only" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                const up = await uploadFile(await compressImage(file, 1280, 0.8), 'cover');
                setBusy(false);
                if (!up.ok) setMsg({ kind: 'bad', text: t(`err.${up.error}` as any) }); else setImage(up.id);
              }} />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={notifyAll} onChange={(e) => setNotifyAll(e.target.checked)} />{t('up.notify')}
            </label>
          </div>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <button type="button" className="btn-primary" disabled={busy || body.trim().length < 3} onClick={async () => {
            setBusy(true); setMsg(null);
            const r = await apiSend<{ notified: number; notifySkipped: boolean }>(`/api/events/${eventId}/post-update`, { body, imageFileId: image, notifyPledgers: notifyAll });
            setBusy(false);
            if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
            setMsg({ kind: r.data.notifySkipped ? 'info' : 'ok', text: r.data.notifySkipped ? t('up.postedNoNotify') : t('up.posted', { n: r.data.notified }) });
            setBody(''); setImage(null);
            router.refresh();
          }}>{busy ? t('a.loading') : t('up.post')}</button>
        </div>
      )}
      {updates.length === 0 ? <p className="text-sm text-muted mt-3">{t('up.none')}</p> : (
        <ul className="mt-4 space-y-3">
          {updates.map((u) => (
            <li key={u.id} className={`rounded-xl bg-surface p-3 ${u.hidden_at ? 'opacity-50' : ''}`}>
              <p className="text-xs text-muted">{new Date(u.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{u.notified ? ` · ${t('up.sentTo', { n: u.notified })}` : ''}{u.hidden_at ? ` · ${t('up.hidden')}` : ''}</p>
              <p className="whitespace-pre-line mt-1">{u.body}</p>
              {u.image_file_id && <img src={`/api/files/${u.image_file_id}`} alt="" className="mt-2 rounded-lg max-h-56 object-cover" />}
              {staffHide && !canPost && !u.hidden_at && (
                <button type="button" className="text-sm text-bad font-semibold mt-1" onClick={async () => {
                  if (!window.confirm(t('up.hideConfirm'))) return;
                  const r = await apiSend('/api/admin/update-hide', { eventId, updateId: u.id });
                  if (r.ok) router.refresh();
                }}>{t('up.hideStaff')}</button>
              )}
              {canPost && !u.hidden_at && (
                <button type="button" className="text-sm text-bad font-semibold mt-1" onClick={async () => {
                  if (!window.confirm(t('up.removeConfirm'))) return;
                  const r = await apiSend(`/api/events/${eventId}/remove-update`, { updateId: u.id });
                  if (r.ok) router.refresh();
                }}>{t('up.remove')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
