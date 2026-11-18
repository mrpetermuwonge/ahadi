import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale } from '@/i18n/server';
import { I18nProvider } from '@/components/I18n';
import { OfflineBanner } from '@/components/Ui';
import { SwRegister } from '@/components/SwRegister';
import { StepUpDialog } from '@/components/StepUpDialog';

// Every page depends on the request (language cookie, session, live ledger), so never pre-render at build time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: { default: 'Ahadi — pledges you can trust', template: '%s · Ahadi' },
  description: 'Collect, track and fulfil pledges for weddings, birthdays, hospital bills and funerals.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  // Default link preview for every page (events set their own picture).
  openGraph: { type: 'website', siteName: 'Ahadi', images: [{ url: '/api/og', width: 1200, height: 630 }] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0D5C54' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1413' },
  ],
};

/*
 * Do NOT add src/app/loading.tsx. In production, router.refresh() (used after every save) re-renders from the root,
 * and a root loading boundary makes React rebuild the whole page: forms close and "Saved" messages vanish.
 * Put loading.tsx files in sub-folders instead (app/, admin/, e/[slug]/, my/, p/[token]/ … have their own).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen font-sans">
        <I18nProvider locale={locale}>
          <OfflineBanner />
          {children}
          <SwRegister />
          <StepUpDialog />
        </I18nProvider>
      </body>
    </html>
  );
}
