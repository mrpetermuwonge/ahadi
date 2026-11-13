'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { apiSend } from '@/components/client-utils';

/** A button that posts one organizer action and refreshes the page; shows a translated error inline. */
export function ActionButton({ eventId, action, body, label, className, confirmText }: {
  eventId: string; action: string; body: unknown; label: string; className: string; confirmText?: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setError(null);
          const r = await apiSend(`/api/events/${eventId}/${action}`, body);
          setBusy(false);
          if (!r.ok) setError(r.error);
          else router.refresh();
        }}
      >
        {busy ? t('a.loading') : label}
      </button>
      {error && <span role="alert" className="text-xs text-bad mt-1">{t(`err.${error}` as any)}</span>}
    </span>
  );
}
