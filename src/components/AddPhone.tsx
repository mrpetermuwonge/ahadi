'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './I18n';
import { Alert } from './Ui';
import { apiSend } from './client-utils';

/** For email / Google accounts: add and verify a phone number with a WhatsApp code. */
export function AddPhone() {
  const { t, locale } = useT();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ identifier: string; channel: string; devCode?: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await apiSend<any>('/api/account/phone', sent ? { phone: sent.identifier, code } : { phone, locale });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'bad', text: t(`err.${r.error}` as any) });
    if (!sent) return setSent(r.data);
    setMsg({ kind: 'ok', text: t('acc.phoneAdded') });
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-3">
      <h2 className="font-bold">{t('acc.addPhone')}</h2>
      <p className="text-sm text-muted">{t('acc.addPhoneHint')}</p>
      {!sent ? (
        <div>
          <label htmlFor="ap-phone" className="label">{t('login.phone')}</label>
          <input id="ap-phone" className="input" inputMode="tel" autoComplete="tel" placeholder="0772 123 456" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      ) : (
        <>
          <p className="text-sm" role="status">{t(sent.channel === 'sms' ? 'login.sentSms' : 'login.sentWhatsapp', { to: sent.identifier })}</p>
          {sent.devCode && <Alert kind="warn">{t('login.devCode', { code: sent.devCode })}</Alert>}
          <div>
            <label htmlFor="ap-code" className="label">{t('login.code')}</label>
            <input id="ap-code" className="input text-xl tracking-[0.4em] text-center" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
          </div>
        </>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn-primary w-full" disabled={busy || (!!sent && code.length !== 6)}>{busy ? t('a.loading') : sent ? t('login.verify') : t('login.sendCode')}</button>
    </form>
  );
}
