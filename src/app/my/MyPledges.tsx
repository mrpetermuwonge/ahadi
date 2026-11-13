'use client';
import { useT } from '@/components/I18n';
import { OrganizerLink, PledgeSummary, VerifyPanel, usePledgerMe } from '@/components/PledgerAccess';
import { PledgerBadge } from '@/components/PledgerBadge';

/** All pledges made with one number. A fresh one-time code is needed each visit (valid 15 minutes). */
export function MyPledges() {
  const { t } = useT();
  const { me, setMe, forget } = usePledgerMe({ entry: false });

  if (!me) return <div className="card p-6 mt-2"><div className="skeleton h-6 w-1/2" /><div className="skeleton h-24 mt-4" /></div>;

  return (
    <div className="space-y-4 mt-2">
      {me.verified && (
        <div className="flex justify-end">
          <PledgerBadge name={me.name ?? me.phone} phone={me.phone} label={t('mine.title')} tag={t('badge.pledger')} />
        </div>
      )}
      {me.verified && me.runsEvents && <OrganizerLink />}
      <section className="card p-5">
        <h1 className="text-2xl font-bold">{t('mine.title')}</h1>
        <p className="text-muted text-sm mt-1">{t('mine.intro')}</p>
        <div className="mt-4">
          {me.verified ? (
            <>
              <p className="font-semibold mb-3">{me.name ? t('me.welcome', { name: me.name.split(' ')[0] }) : t('me.welcomeNoName')}</p>
              <PledgeSummary me={me} limit={10} views />
            </>
          ) : (
            <VerifyPanel onVerified={setMe} />
          )}
        </div>
      </section>
      {me.verified && <button className="btn-ghost w-full" onClick={forget}>{t('mine.done')}</button>}
    </div>
  );
}
