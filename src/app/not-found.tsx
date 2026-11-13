import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';

export default function NotFound() {
  const { t } = getT();
  return (
    <div className="mx-auto max-w-md px-4 py-10 text-center">
      <Logo />
      <div className="mt-2"><BackLink fallback="/" /></div>
      <p className="text-6xl font-extrabold text-brand mt-8">404</p>
      <p className="mt-2 text-lg">{t('err.not_found')}</p>
      <Link href="/" className="btn-primary mt-6">{t('nav.home')}</Link>
    </div>
  );
}
