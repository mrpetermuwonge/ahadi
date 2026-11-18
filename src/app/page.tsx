import Link from 'next/link';
import { getT } from '@/i18n/server';
import { Logo, TypeIcon } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { currentUser } from '@/lib/web';
import type { Key } from '@/i18n';
import { Footer } from '@/components/Footer';
import { FeaturedEvents } from '@/components/FeaturedEvents';
import { PartnersStrip } from '@/components/PartnersStrip';
import { ContactCards } from '@/components/ContactCards';
import { ContactForm } from '@/app/help/ContactForm';
import { publicPartners } from '@/lib/services/partners';
import { EndPledgerSession } from '@/components/PledgerAccess';
import { featuredEvents } from '@/lib/services/events';
import { getDb } from '@/lib/db';
import { EVENT_TYPES, isSombre, toneClass } from '@/lib/eventTypes';
import { formatDate } from '@/lib/time';

export default async function Landing() {
  const { t } = getT();
  const user = await currentUser();
  // Events whose owners chose to be shown here (and Ahadi approved). Hidden entirely when there are none.
  const db = await getDb();
  const events = await featuredEvents(db);
  const partners = (await publicPartners(db)).map((p) => ({ id: p.id, name: p.name, tagline: p.tagline, url: p.url, logoFileId: p.logo_file_id }));
  // Public cards carry no money amounts: only the date and how many people support the event.
  const slides = events.map((e) => ({ ...e, dateText: e.eventDate ? formatDate(e.eventDate) : null }));
  // Hero card: the featured celebration with the most supporters (uplifting first impression), else any featured event.
  const pool = slides.filter((e) => !isSombre(e.type));
  const hero = [...(pool.length ? pool : slides)].sort((a, b) => b.pledgeCount - a.pledgeCount)[0] ?? null;
  const types = ['wedding', 'birthday', 'hospital', 'funeral', 'community'] as const;
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto w-full max-w-5xl flex items-center justify-between px-4 py-3">
        <Logo />
        <div className="flex items-center gap-2">
          <LangSwitcher />
          <Link href="/my" className="btn-ghost min-h-[44px] px-3 hidden sm:inline-flex">{t('nav.myPledges')}</Link>
          <Link href={user ? '/app' : '/login'} className="btn-ghost min-h-[44px] px-3">{user ? t('nav.events') : t('a.login')}</Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 pt-8 pb-12 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight">{t('landing.hero')}</h1>
            <p className="mt-4 text-lg text-muted">{t('landing.sub')}</p>
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Link href={user ? '/app/new' : '/login?next=/app/new'} className="btn-primary text-lg">{t('landing.cta')}</Link>
              {/* Pledgers' way in, visible on phones too (the header link is hidden on small screens). */}
              <Link href="/my" className="btn-outline text-lg">
                <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01" /></svg>
                {t('nav.myPledges')}
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted flex gap-2 items-start">
              <svg aria-hidden className="w-5 h-5 shrink-0 text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>
              {t('landing.trust')}
            </p>
          </div>
          {hero ? (
            <Link href={`/e/${hero.slug}`} className={`${toneClass(hero.type)} card overflow-hidden tap hover:shadow-lg transition-shadow block`}>
              <div className="relative">
                {hero.coverFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${hero.coverFileId}`} alt="" className="w-full aspect-[16/9] object-cover bg-brand-soft" />
                ) : (
                  <div className="w-full aspect-[16/9] bg-gradient-to-br from-accent/70 to-brand/80 flex items-center justify-center text-white/90">
                    <TypeIcon type={hero.type} className="w-14 h-14" />
                  </div>
                )}
                <span className="absolute top-3 left-3 chip bg-card/95 text-ink shadow-soft">★ {t('home.featured')}</span>
              </div>
              <div className="p-5">
                <div className="flex flex-wrap gap-1.5">
                  <span className="chip bg-brand-soft text-brand"><TypeIcon type={hero.type} className="w-3 h-3" />{t(`type.${hero.type}` as Key)}</span>
                  {hero.verified && <span className="chip bg-ok/15 text-ok">✓ {t('ev.verified')}</span>}
                </div>
                <h2 className="text-xl font-bold mt-2 leading-snug">{hero.title}</h2>
                <p className="text-sm text-muted">{t(`who.${hero.organizerKind}` as Key)}</p>
                <div className="mt-3 flex justify-between text-sm text-muted">
                  <span>{hero.dateText ?? ''}</span>
                  <span>{t('home.supporters', { n: hero.pledgeCount })}</span>
                </div>
                <div className="btn-accent w-full mt-4">{t(`noun.${EVENT_TYPES[hero.type].noun}.verb` as Key)}</div>
              </div>
            </Link>
          ) : (
            // No approved events yet: a neutral illustration (no made-up names or amounts).
            <div className="card p-5 tone-celebratory" aria-hidden>
              <div className="h-32 rounded-xl bg-gradient-to-br from-accent/70 to-brand/80 mb-4" />
              <div className="h-5 w-3/4 rounded bg-ink/80" />
              <div className="mt-2 h-3 w-1/3 rounded bg-muted/40" />
              <div className="mt-4 h-3 rounded-full bg-line overflow-hidden"><div className="h-full w-2/3 bg-brand rounded-full" /></div>
              <div className="mt-2 flex justify-between"><span className="h-3 w-24 rounded bg-ink/60" /><span className="h-3 w-16 rounded bg-muted/40" /></div>
              <div className="btn-accent w-full mt-4">{t('noun.pledge.verb')}</div>
            </div>
          )}
        </section>

        <FeaturedEvents slides={slides} />
        <EndPledgerSession />

        <section className="bg-card border-y border-line/60">
          <div className="mx-auto max-w-5xl px-4 py-10">
            <h2 className="text-2xl font-bold">{t('landing.how')}</h2>
            <ol className="mt-6 grid sm:grid-cols-3 gap-4">
              {(['landing.how1', 'landing.how2', 'landing.how3'] as Key[]).map((k, i) => (
                <li key={k} className="rounded-2xl bg-surface p-5">
                  <div className="w-10 h-10 rounded-full bg-brand text-brand-ink font-bold flex items-center justify-center">{i + 1}</div>
                  <p className="mt-3 font-medium">{t(k)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-10">
          <h2 className="text-2xl font-bold">{t('landing.for')}</h2>
          <ul className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
            {types.map((ty) => (
              <li key={ty} className="card p-4 flex flex-col gap-2">
                <TypeIcon type={ty} className="w-7 h-7 text-brand" />
                <span className="font-semibold">{t(`type.${ty}` as Key)}</span>
                <span className="text-sm text-muted">{t(`type.${ty}.d` as Key)}</span>
              </li>
            ))}
          </ul>
        </section>

        <PartnersStrip partners={partners} />

        {/* Contact Ahadi: call, email, website, or send a message right here (answered in the Support inbox). */}
        <section id="contact" aria-labelledby="contact-title" className="scroll-mt-4 px-4 py-12">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] text-white shadow-xl"
            style={{ background: 'linear-gradient(135deg, #0D5C54 0%, #0A4740 60%, #7a5a1c 130%)' }}>
            <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#F6C76A]/20 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
            <div className="relative grid md:grid-cols-[1fr,1.1fr] gap-8 p-6 sm:p-10">
              <div className="flex flex-col">
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide uppercase text-[#F6C76A]">
                  <span className="relative flex w-2 h-2"><span className="absolute inline-flex h-full w-full rounded-full bg-[#F6C76A] opacity-75 motion-safe:animate-ping" /><span className="relative inline-flex w-2 h-2 rounded-full bg-[#F6C76A]" /></span>
                  {t('ct.kicker')}
                </span>
                <h2 id="contact-title" className="mt-4 text-3xl sm:text-4xl font-extrabold leading-tight">{t('ct.title')}</h2>
                <p className="mt-3 text-white/80">{t('ct.text')}</p>
                <div className="mt-6"><ContactCards tone="dark" labels={{ call: t('ct.call'), email: t('ct.email'), web: t('ct.web') }} /></div>
                <div className="mt-6 flex flex-wrap gap-2">
                  {(['payment', 'pledge', 'event', 'fraud'] as const).map((k) => (
                    <Link key={k} href={`/help?topic=${k}#contact`} className="rounded-full bg-white/10 hover:bg-white/20 ring-1 ring-white/20 px-3 py-1.5 text-sm">{t(`hp.t.${k}` as Key)}</Link>
                  ))}
                  <Link href="/help" className="rounded-full bg-[#F6C76A] text-[#0A4740] px-3 py-1.5 text-sm font-semibold">{t('ct.faq')} →</Link>
                </div>
              </div>
              <div className="text-ink"><ContactForm /></div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
