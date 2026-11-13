import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale } from '@/i18n/server';
import { I18nProvider } from '@/components/I18n';
import { OfflineBanner } from '@/components/Ui';
import { SwRegister } from '@/components/SwRegister';

// Every page depends on the request (language cookie, session, live ledger), so never pre-render at build time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Ahadi — pledges you can trust', template: '%s · Ahadi' },
  description: 'Collect, track and fulfil pledges for weddings, birthdays, hospital bills and funerals.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0D5C54' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1413' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen font-sans">
        <I18nProvider locale={locale}>
          <OfflineBanner />
          {children}
          <SwRegister />
        </I18nProvider>
      </body>
    </html>
  );
}
