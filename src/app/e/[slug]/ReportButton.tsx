'use client';
import { useState } from 'react';
import { useT } from '@/components/I18n';
import { apiSend } from '@/components/client-utils';
import { Alert } from '@/components/Ui';

export function ReportButton({ eventId }: { eventId: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sent) return <Alert kind="ok">{t('ev.reportSent')}</Alert>;
  if (!open)
    return (
      <button className="text-sm text-muted underline min-h-[44px]" onClick={() => setOpen(true)}>
        {t('ev.report')}
      </button>
    );
  return (
    <form
      className="card p-4 text-left space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await apiSend('/api/reports', { eventId, reason });
        if (r.ok) setSent(true);
        else setError(r.error);
      }}
    >
      <label className="label" htmlFor="reason">{t('ev.reportReason')}</label>
      <textarea id="reason" className="input" rows={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <Alert kind="bad">{t(`err.${error}` as any)}</Alert>}
      <div className="flex gap-2">
        <button className="btn-primary flex-1">{t('ev.report')}</button>
        <button type="button" className="btn-outline" onClick={() => setOpen(false)}>{t('a.cancel')}</button>
      </div>
    </form>
  );
}
