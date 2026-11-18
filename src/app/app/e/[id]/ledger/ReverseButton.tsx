'use client';
import { useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { apiSend } from '@/components/client-utils';

export function ReverseButton({ eventId, journalId }: { eventId: string; journalId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        className="btn-outline min-h-[36px] px-3 text-xs"
        onClick={async () => {
          const reason = window.prompt(t('ledger.reverseReason'));
          if (!reason) return;
          const r = await apiSend(`/api/events/${eventId}/reverse`, { journalId, reason });
          if (!r.ok) setError(r.error);
          else startTransition(() => router.refresh());
        }}
      >
        {t('ledger.reverse')}
      </button>
      {error && <span role="alert" className="text-xs text-bad">{t(`err.${error}` as any)}</span>}
    </span>
  );
}
