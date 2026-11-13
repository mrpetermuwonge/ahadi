import Link from 'next/link';
import { getT } from '@/i18n/server';

export function Footer() {
  const { t } = getT();
  return (
    <footer className="border-t border-line/60 py-6 text-sm text-muted">
      <div className="mx-auto max-w-5xl px-4 flex flex-wrap gap-4 justify-between">
        <span>© Ahadi · {t('footer.made')}</span>
        <span className="flex gap-4">
          <Link className="underline" href="/my">{t('nav.myPledges')}</Link>
          <Link className="underline" href="/privacy">{t('legal.privacy')}</Link>
          <Link className="underline" href="/terms">{t('legal.terms')}</Link>
        </span>
      </div>
    </footer>
  );
}
