'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useT } from '@/components/I18n';
import { Logo } from '@/components/Brand';
import { BackLink } from '@/components/BackLink';

/** Friendly screen when a page fails to load: say nothing was lost, offer "Try again", Back and Home. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <Logo />
      <div className="mt-2 text-left"><BackLink fallback="/" /></div>
      <svg aria-hidden className="mx-auto mt-6 w-16 h-16 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.5h.01" />
      </svg>
      <p className="mt-4 text-lg font-semibold">{t('err.generic')}</p>
      {error.digest && <p className="text-xs text-muted mt-2">Ref: {error.digest}</p>}
      <div className="grid gap-2 mt-6">
        <button type="button" className="btn-primary" onClick={() => reset()}>{t('a.retry')}</button>
        <Link href="/" className="btn-outline">{t('nav.home')}</Link>
      </div>
    </div>
  );
}
