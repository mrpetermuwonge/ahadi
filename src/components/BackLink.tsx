'use client';
import { useRouter } from 'next/navigation';
import { useT } from './I18n';

/**
 * "← Back" for pledger pages. People often open these from a WhatsApp link, where there is no previous
 * Ahadi page to go back to, so we only use the browser's history when the previous page was on Ahadi;
 * otherwise we go to a sensible page (usually the event).
 */
export function BackLink({ fallback, label }: { fallback: string; label?: string }) {
  const { t } = useT();
  const router = useRouter();
  return (
    <a
      href={fallback}
      onClick={(e) => {
        let cameFromAhadi = false;
        try {
          cameFromAhadi = !!document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1;
        } catch {
          cameFromAhadi = false;
        }
        if (cameFromAhadi) {
          e.preventDefault();
          router.back();
        }
      }}
      className="inline-flex items-center gap-1.5 min-h-[44px] pr-3 -ml-1 font-semibold text-brand hover:underline"
    >
      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label ?? t('a.back')}
    </a>
  );
}
