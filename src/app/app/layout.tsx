import Link from 'next/link';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { PledgerBadge } from '@/components/PledgerBadge';
import { LogoutButton } from './LogoutButton';
import { AppBack } from './AppBack';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/app');
  const { t } = getT();
  // Badge tag: "Organizer" if this account runs at least one event, else "Committee" (treasurer/helper); admins see "Admin".
  const [{ owns }] = await (await getDb()).query<{ owns: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM event_members WHERE user_id=$1 AND role='owner') AS owns`, [user.id]);
  const badgeTag = user.is_admin ? t('badge.admin') : owns ? t('badge.organizer') : t('badge.committee');
  // "My pledges" opens the pledger portal for this account's number (a plain link: it starts a short portal visit).
  const nav: { href: string; label: string; d: string; plain?: boolean }[] = [
    { href: '/app', label: t('nav.events'), d: 'M4 6h16M4 12h16M4 18h10' },
    { href: '/app/new', label: t('nav.new'), d: 'M12 5v14M5 12h14' },
    { href: '/api/pledger/from-account', label: t('nav.myPledges'), d: 'M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z', plain: true },
    ...(user.is_admin ? [{ href: '/admin', label: t('nav.admin'), d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' }] : []),
  ];
  // "My pledges" opens the pledger portal (it sets a cookie), so it is a small form posted by a button, not a link.
  const item = (n: (typeof nav)[number], cls: string, inner: React.ReactNode) =>
    n.plain ? (
      <form key={n.href} method="post" action={n.href} className="contents">
        <button type="submit" className={`${cls} w-full`}>{inner}</button>
      </form>
    ) : <Link key={n.href} href={n.href} className={cls}>{inner}</Link>;
  return (
    <div className="min-h-screen pb-24 md:pb-6">
      <header className="sticky top-0 z-20 bg-surface/90 backdrop-blur border-b border-line/60">
        <div className="mx-auto max-w-3xl flex items-center justify-between px-4 py-2">
          <Logo />
          <div className="flex items-center gap-1">
            <nav className="hidden md:flex gap-1 mr-2">
              {nav.map((n) => item(n, 'btn-ghost min-h-[40px] px-3 text-sm', n.label))}
            </nav>
            <LangSwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pt-2 flex items-center justify-between gap-3">
        <AppBack />
        {/* Tap the badge to open My account (set your name there). */}
        <Link href="/app/account" className="ml-auto tap rounded-xl -mr-1 px-1 py-0.5 hover:bg-brand-soft" aria-label={t('acct.title')}>
          <PledgerBadge name={user.name ?? user.phone ?? user.email ?? ''} phone={user.phone ?? user.email ?? ''} label={badgeTag} tag={badgeTag} />
        </Link>
      </div>
      <main className="mx-auto max-w-3xl px-4 py-4">{children}</main>
      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="flex">
          {nav.map((n) => (
            <li key={n.href} className="flex-1">
              {item(n, 'tap flex flex-col items-center justify-center gap-0.5 min-h-[60px] text-xs font-semibold text-muted hover:text-brand', (
                <>
                  <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={n.d} /></svg>
                  {n.label}
                </>
              ))}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
