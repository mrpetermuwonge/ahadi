import Link from 'next/link';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { BackLink } from '@/components/BackLink';
import { Footer } from '@/components/Footer';
import type { Key } from '@/i18n';
import { ContactForm } from './ContactForm';
import { ContactCards } from '@/components/ContactCards';
import { ContactNav } from '@/components/ContactNav';

export const metadata = { title: 'Help' };

const FAQ: { group: Key; items: number[] }[] = [
  { group: 'hp.g.pledgers', items: [1, 2, 3, 4, 5] },
  { group: 'hp.g.payments', items: [6, 7, 8] },
  { group: 'hp.g.organizers', items: [9, 10, 11, 12] },
  { group: 'hp.g.safety', items: [13, 14] },
];

/** Help: answers to common questions, then "Contact Ahadi" (with a private link to follow the answer). */
export default function HelpPage({ searchParams }: { searchParams: { topic?: string } }) {
  const { t } = getT();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-3xl flex items-center justify-between px-4 py-3"><Logo /><div className="flex items-center gap-2"><ContactNav /><LangSwitcher /></div></header>
      <nav className="mx-auto w-full max-w-3xl px-4"><BackLink fallback="/" /></nav>
      <main className="mx-auto w-full max-w-3xl px-4 pb-12 flex-1 space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold">{t('hp.title')}</h1>
          <p className="text-muted mt-1">{t('hp.intro')}</p>
          <p className="mt-3"><a href="#contact" className="btn-outline min-h-[40px] px-4 text-sm">{t('hp.contactTitle')} ↓</a></p>
        </div>
        {FAQ.map((g) => (
          <section key={g.group}>
            <h2 className="text-lg font-bold">{t(g.group)}</h2>
            <div className="mt-2 space-y-2">
              {g.items.map((n) => (
                <details key={n} className="card p-4 group">
                  <summary className="font-semibold cursor-pointer list-none flex justify-between gap-3">
                    <span>{t(`hp.q${n}` as Key)}</span><span aria-hidden className="text-brand group-open:rotate-45 transition-transform">+</span>
                  </summary>
                  <p className="text-sm text-muted mt-2 whitespace-pre-line">{t(`hp.a${n}` as Key)}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
        <div id="contact" className="scroll-mt-4 grid md:grid-cols-[1fr,1.4fr] gap-4 items-start">
          <div className="space-y-3">
            <h2 className="text-lg font-bold">{t('ct.reach')}</h2>
            <ContactCards labels={{ call: t('ct.call'), email: t('ct.email'), web: t('ct.web') }} />
          </div>
          <ContactForm initialTopic={searchParams.topic} />
        </div>
        <p className="text-sm text-muted">{t('hp.privacy')} <Link className="underline" href="/privacy">{t('hp.privacyLink')}</Link></p>
      </main>
      <Footer />
    </div>
  );
}
