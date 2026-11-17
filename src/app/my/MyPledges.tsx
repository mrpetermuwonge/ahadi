'use client';
import Link from 'next/link';
import { useT } from '@/components/I18n';
import { OrganizerLink, PledgeSummary, VerifyPanel, usePledgerMe } from '@/components/PledgerAccess';
import { PledgerBadge } from '@/components/PledgerBadge';

/** All pledges made with one number. A fresh one-time code is needed each visit (valid 15 minutes). */
export function MyPledges() {
  const { t } = useT();
  const { me, setMe, forget } = usePledgerMe({ entry: false });

  if (!me) return <div className="card p-6 mt-2"><div className="skeleton h-6 w-1/2" /><div className="skeleton h-24 mt-4" /></div>;

  const empty = me.verified && me.items.length === 0;

  return (
    <div className="space-y-4 mt-2">
      {me.verified && (
        <div className="flex justify-end">
          <PledgerBadge name={me.name ?? me.phone} phone={me.phone} label={t('mine.title')} tag={t('badge.pledger')} />
        </div>
      )}
      {me.verified && me.runsEvents && <OrganizerLink />}
      {empty ? (
        // Verified, but nothing pledged with this number yet: say so plainly and offer the next step.
        <section className="card p-6 text-center">
          <svg aria-hidden className="mx-auto w-20 h-20 text-accent" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M40 66s-20-12.5-20-28a11 11 0 0 1 20-6.5A11 11 0 0 1 60 38c0 15.5-20 28-20 28z" className="fill-accent/15" />
            <path d="M34 40h12M40 34v12" />
          </svg>
          <h1 className="text-xl font-bold mt-3">{t('mine.emptyTitle')}</h1>
          <p className="text-muted text-sm mt-1">{t('mine.emptyText')}</p>
          <div className="grid gap-2 mt-5">
            <Link href="/#happening" className="btn-accent">{t('mine.findEvent')}</Link>
            <Link href="/" className="btn-outline">{t('mine.backHome')}</Link>
          </div>
        </section>
      ) : (
        <section className="card p-5">
          <h1 className="text-2xl font-bold">{t('mine.title')}</h1>
          <p className="text-muted text-sm mt-1">{t('mine.intro')}</p>
          <div className="mt-4">
            {me.verified ? (
              <>
                <p className="font-semibold mb-3">{me.name && /\p{L}/u.test(me.name) && !me.name.startsWith('+') ? t('me.welcome', { name: me.name.split(' ')[0] }) : t('me.welcomeNoName')}</p>
                <PledgeSummary me={me} limit={10} views />
              </>
            ) : (
              <VerifyPanel onVerified={setMe} />
            )}
          </div>
        </section>
      )}
      {/* With no pledges, "Back to home" already closes the portal (the homepage ends the verification). */}
      {me.verified && !empty && <button className="btn-ghost w-full" onClick={forget}>{t('mine.done')}</button>}
    </div>
  );
}
