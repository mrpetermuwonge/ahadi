'use client';
import { useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { Alert } from '@/components/Ui';
import { apiSend } from '@/components/client-utils';

/** The person adds a message to their own support request. */
export function RequesterReply({ token }: { token: string }) {
  const { t } = useT();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card p-4 space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const r = await apiSend(`/api/support/${token}`, { body });
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setBody('');
      startTransition(() => router.refresh());
    }}>
      <label className="label" htmlFor="rr-body">{t('hp.addMessage')}</label>
      <textarea id="rr-body" className="input" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
      <button className="btn-primary" disabled={busy || body.trim().length < 2}>{busy ? t('a.loading') : t('hp.send')}</button>
    </form>
  );
}
