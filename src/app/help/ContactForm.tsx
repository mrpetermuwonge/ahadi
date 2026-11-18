'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';
import { goToContactForm } from '@/components/ContactNav';

const TOPICS = ['payment', 'pledge', 'event', 'account', 'fraud', 'other'] as const;

/** Contact Ahadi support. The person gets a reference number and a private link to follow the answer. */
export function ContactForm({ initialTopic }: { initialTopic?: string }) {
  const { t } = useT();
  const [f, setF] = useState({
    name: '', contact: '', message: '', eventRef: '', website: '',
    topic: (TOPICS as readonly string[]).includes(initialTopic ?? '') ? (initialTopic as string) : 'payment',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string; token: string } | null>(null);
  // Arrived from "Contact us" on another page (…#contact): bring the form into view and highlight it.
  useEffect(() => {
    if (window.location.hash !== '#contact') return;
    const el = document.getElementById('contact-form');
    if (el) window.setTimeout(() => goToContactForm(el, true), 150);
  }, []);
  if (done) {
    return (
      <div id="contact-form" className="card p-5 space-y-3" role="status">
        <Alert kind="ok">{t('hp.sent', { ref: done.ref })}</Alert>
        <p className="text-sm">{t('hp.sentHint')}</p>
        <Link className="btn-primary" href={`/help/r/${done.token}`}>{t('hp.openRequest')}</Link>
      </div>
    );
  }
  return (
    <form id="contact-form" className="card p-5 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const r = await apiSend<{ ref: string; token: string }>('/api/support', { ...f, eventRef: f.eventRef || null });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setDone(r.data);
    }}>
      <h2 className="text-lg font-bold">{t('hp.contactTitle')}</h2>
      <p className="text-sm text-muted">{t('hp.contactHint')}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="label" htmlFor="hp-name">{t('pf.name')}</label><input id="hp-name" className="input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div><label className="label" htmlFor="hp-contact">{t('hp.contact')}</label><input id="hp-contact" className="input" maxLength={120} placeholder="0772 123 456" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} required /></div>
      </div>
      <div>
        <label className="label" htmlFor="hp-topic">{t('hp.topic')}</label>
        <select id="hp-topic" className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
          {TOPICS.map((x) => <option key={x} value={x}>{t(`hp.t.${x}` as any)}</option>)}
        </select>
      </div>
      <div><label className="label" htmlFor="hp-ref">{t('hp.eventRef')}</label><input id="hp-ref" className="input" maxLength={200} placeholder={t('hp.eventRefPh')} value={f.eventRef} onChange={(e) => setF({ ...f, eventRef: e.target.value })} /></div>
      <div><label className="label" htmlFor="hp-msg">{t('hp.message')}</label><textarea id="hp-msg" className="input" rows={5} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required /></div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
      <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? t('a.loading') : t('hp.send')}</button>
    </form>
  );
}
