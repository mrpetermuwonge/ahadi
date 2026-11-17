import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/web';
import { getT } from '@/i18n/server';
import { eventTotals } from '@/lib/ledger';
import { formatMoney } from '@/lib/money';
import { formatPhone } from '@/lib/phone';
import { getSettings, DEFAULT_SETTINGS } from '@/lib/settings';
import { Logo } from '@/components/Brand';
import { LangSwitcher } from '@/components/Ui';
import { LogoutButton } from '@/app/app/LogoutButton';
import { AdminButton, SettingsEditor, RunJobs, TeamForm, ReassignOwner, EraseForm, OpsButton } from './AdminClient';
import { backupDir, health, opsRuns, BACKUP_KEEP } from '@/lib/services/ops';
import { PRIVACY_VERSION, RETENTION } from '@/lib/privacy';
import { Alert } from '@/components/Ui';
import { codesOnScreen } from '@/lib/services/auth';
import { platformAnalytics } from '@/lib/services/adminAnalytics';
import { listAdmins } from '@/lib/services/adminTeam';
import { adminPermissionsFor, adminRoleOf, MONEY_SETTINGS, type AdminPermission } from '@/lib/adminPermissions';
import type { Key } from '@/i18n';

export const metadata = { title: 'Admin', robots: { index: false } };

type Perms = Record<AdminPermission, boolean>;
const TABS = ['overview', 'events', 'payments', 'flags', 'payouts', 'verifications', 'revenue', 'settings', 'recon', 'privacy', 'system', 'audit', 'team'] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY: Record<Tab, Key> = {
  overview: 'ax.overview', events: 'adm.events', flags: 'adm.flags', payouts: 'adm.payouts', verifications: 'adm.verifications',
  revenue: 'adm.revenue', settings: 'adm.settings', recon: 'adm.recon', audit: 'adm.audit', team: 'ax.team',
  payments: 'ax.payments', privacy: 'ax.privacy', system: 'ax.system',
};
/** Which permission lets a staff member open each tab. */
const TAB_PERM: Record<Tab, AdminPermission> = {
  overview: 'admin.view', events: 'admin.view', flags: 'admin.view', payouts: 'payouts.view', verifications: 'admin.view',
  revenue: 'revenue.view', settings: 'admin.view', recon: 'admin.view', audit: 'audit.view', team: 'admin.view',
  payments: 'payments.view', privacy: 'admin.view', system: 'ops.view',
};
const PERIODS = [7, 30, 90, 365];

export default async function AdminPage({ searchParams }: { searchParams: { tab?: string; days?: string; q?: string; pq?: string } }) {
  const user = await requireAdmin();
  const { t } = getT();
  const perms = adminPermissionsFor(user);
  const role = adminRoleOf(user)!;
  const allowed = TABS.filter((x) => perms[TAB_PERM[x]]);
  const tab: Tab = (allowed as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as Tab) : 'overview';
  const days = PERIODS.includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/60 bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Logo />
            <span className="chip bg-accent/20 text-ink whitespace-nowrap">{t('adm.title')} · {t(`ax.role.${role}` as Key)}</span>
          </div>
          <div className="flex items-center gap-1">
            <LangSwitcher />
            <Link href="/app" className="btn-ghost min-h-[40px] px-3 text-sm hidden sm:inline-flex">{t('nav.events')}</Link>
            <LogoutButton />
          </div>
        </div>
        <nav className="mx-auto max-w-6xl px-4 overflow-x-auto" aria-label={t('adm.title')}>
          <ul className="flex gap-1 min-w-max">
            {allowed.map((x) => (
              <li key={x}>
                <Link href={`/admin?tab=${x}`} aria-current={tab === x ? 'page' : undefined}
                  className={`inline-flex min-h-[44px] items-center px-3 text-sm font-semibold border-b-2 ${tab === x ? 'border-brand text-brand' : 'border-transparent text-muted'}`}>
                  {t(TAB_KEY[x])}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <nav className="mx-auto max-w-6xl px-4 pt-2"><BackLink fallback="/app" /></nav>
      <main className="mx-auto max-w-6xl px-4 py-5">
        {codesOnScreen() && <div className="mb-4"><Alert kind="warn">{t('adm.codesOnScreen')}</Alert></div>}
        {role === 'support' && <div className="mb-4"><Alert kind="info">{t('ax.readOnly')}</Alert></div>}
        {tab === 'overview' && <OverviewTab days={days} perms={perms} />}
        {tab === 'events' && <EventsTab perms={perms} q={searchParams.q ?? ''} />}
        {tab === 'flags' && <FlagsTab perms={perms} />}
        {tab === 'payouts' && <PayoutsTab perms={perms} />}
        {tab === 'verifications' && <VerificationsTab perms={perms} />}
        {tab === 'revenue' && <RevenueTab />}
        {tab === 'settings' && <SettingsTab perms={perms} userId={user.id} />}
        {tab === 'recon' && <ReconTab perms={perms} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'team' && <TeamTab perms={perms} userId={user.id} />}
        {tab === 'payments' && <PaymentsTab perms={perms} q={searchParams.pq ?? ''} />}
        {tab === 'privacy' && <PrivacyTab perms={perms} />}
        {tab === 'system' && <SystemTab perms={perms} />}
      </main>
    </div>
  );
}

function Empty() {
  const { t } = getT();
  return <p className="card p-6 text-muted text-center">{t('adm.none')}</p>;
}

/* ------------------------------------------------------------------ Overview / analytics */

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'brand' | 'warn' | 'bad' }) {
  const c = tone === 'brand' ? 'text-brand' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : '';
  return (
    <div className="card p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-extrabold mt-1 ${c}`}>{value}</p>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Bar({ value, max, className = 'bg-brand' }: { value: number; max: number; className?: string }) {
  return <span className="block h-2 rounded-full bg-line overflow-hidden"><span className={`block h-full rounded-full ${className}`} style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} /></span>;
}

async function OverviewTab({ days, perms }: { days: number; perms: Perms }) {
  const { t } = getT();
  const a = await platformAnalytics(await getDb(), days);
  const m = (n: number) => formatMoney(n);
  const maxDay = Math.max(1, ...a.daily.map((d) => Math.max(d.pledged, d.collected)));
  const maxType = Math.max(1, ...a.byType.map((r) => r.pledged));
  const maxTop = Math.max(1, ...a.top.map((r) => r.collected));
  const queue: [Key, number, string][] = [
    ['ax.q.flags', a.queue.flags, 'flags'],
    ['ax.q.verifications', a.queue.verifications, 'verifications'],
    ['ax.q.payouts', a.payouts.in_review, 'payouts'],
    ['ax.q.home', a.queue.home, 'events'],
    ['ax.q.recon', a.queue.recon, 'recon'],
    ['ax.q.proposals', a.queue.proposals, 'settings'],
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={t('ax.period')}>
          {PERIODS.map((p) => (
            <Link key={p} href={`/admin?tab=overview&days=${p}`} aria-current={p === days ? 'true' : undefined}
              className={`btn min-h-[36px] px-3 text-sm ${p === days ? 'bg-brand text-white' : 'btn-outline'}`}>{t('ax.days', { n: p })}</Link>
          ))}
        </div>
        {perms['analytics.export'] && <a className="btn-outline min-h-[36px] px-3 text-sm" href={`/api/admin/analytics?days=${days}`}>{t('ax.exportCsv')}</a>}
      </div>

      {/* Work waiting for the team */}
      <section>
        <h2 className="font-bold mb-2">{t('ax.queue')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {queue.map(([k, n, tab]) => (
            <Link key={k} href={`/admin?tab=${tab}`} className={`card p-4 tap hover:border-brand/40 ${n > 0 ? 'border-accent' : ''}`}>
              <p className="text-xs text-muted">{t(k)}</p>
              <p className={`text-2xl font-extrabold ${n > 0 ? 'text-warn' : 'text-ok'}`}>{n}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Money */}
      <section>
        <h2 className="font-bold mb-2">{t('ax.money')} <span className="text-sm font-normal text-muted">· {t('ax.lastDays', { n: days })}</span></h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label={t('dash.pledged')} value={m(a.money.pledged)} sub={t('ax.allTime', { v: m(a.money.pledgedAllTime) })} />
          <Kpi label={t('dash.collected')} value={m(a.money.collected)} sub={t('ax.offline', { v: m(a.money.collectedOffline) })} tone="brand" />
          <Kpi label={t('ax.collectionRate')} value={`${a.money.collectionRate}%`} sub={t('ax.collectedAll', { v: m(a.money.collectedAllTime) })} />
          <Kpi label={t('dash.outstanding')} value={m(a.money.outstanding)} sub={t('ax.now')} tone={a.money.outstanding > 0 ? 'warn' : undefined} />
          <Kpi label={t('ax.held')} value={m(a.money.heldForOrganizers)} sub={t('ax.heldSub')} />
          <Kpi label={t('ax.paidOut')} value={m(a.payouts.paid)} sub={t('ax.paidOutSub', { n: a.payouts.paid_n, v: m(a.money.paidOutAllTime) })} />
          <Kpi label={t('adm.payoutsPending')} value={m(a.money.payoutPending)} sub={t('ax.payoutQueue', { r: a.payouts.in_review, s: a.payouts.awaiting })} />
          <Kpi label={t('ax.revenue')} value={m(a.revenue.total)} sub={t('ax.revenueSub', { f: m(a.revenue.fees), t: m(a.revenue.tips) })} tone="brand" />
        </div>
      </section>

      {/* Trend */}
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.trend')}</h2>
        {a.daily.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
          <>
            <div className="mt-4 flex items-end gap-[3px] h-36" role="img" aria-label={t('ax.trend')}>
              {a.daily.map((d) => (
                <div key={d.day} className="flex-1 flex items-end gap-px h-full min-w-[4px]" title={`${d.day}: ${m(d.pledged)} / ${m(d.collected)}`}>
                  <div className="flex-1 bg-accent/50 rounded-t" style={{ height: `${(d.pledged / maxDay) * 100}%` }} />
                  <div className="flex-1 bg-brand rounded-t" style={{ height: `${(d.collected / maxDay) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>{a.daily[0]?.day}</span>
              <span className="flex gap-3"><span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-accent/50" />{t('dash.pledged')}</span><span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-brand" />{t('dash.collected')}</span></span>
              <span>{a.daily[a.daily.length - 1]?.day}</span>
            </div>
          </>
        )}
      </section>

      {/* Activity */}
      <section>
        <h2 className="font-bold mb-2">{t('ax.activity')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label={t('ax.eventsCreated')} value={String(a.events.created)} sub={t('ax.eventsNow', { a: a.events.active, c: a.events.closed })} />
          <Kpi label={t('ax.pledgesMade')} value={String(a.pledges.n)} sub={t('ax.avgPledge', { v: m(a.pledges.avg) })} />
          <Kpi label={t('ax.fullyPaid')} value={`${a.pledges.fullyPaidRate}%`} sub={t('ax.partPaid', { n: a.pledges.part_paid })} />
          <Kpi label={t('ax.paySuccess')} value={`${a.payments.successRate}%`} sub={t('ax.payAttempts', { ok: a.payments.succeeded, n: a.payments.attempts })} tone={a.payments.attempts > 0 && a.payments.successRate < 70 ? 'bad' : undefined} />
          <Kpi label={t('ax.organizers')} value={String(a.people.organizers)} sub={t('ax.newOrganizers', { n: a.people.new_organizers })} />
          <Kpi label={t('ax.pledgers')} value={String(a.people.pledgers)} sub={t('ax.pledgersPeriod', { n: a.pledges.people })} />
          <Kpi label={t('ax.trust')} value={t('ax.trustValue', { v: a.events.verified, f: a.events.frozen })} sub={t('ax.trustSub', { u: a.events.urgent, h: a.events.on_home })} />
          <Kpi label={t('ax.staff')} value={String(a.people.admins)} sub={t('ax.newUsers', { n: a.people.new_users })} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card p-5">
          <h2 className="font-bold">{t('adm.byType')}</h2>
          <ul className="mt-3 space-y-3">
            {a.byType.map((r) => (
              <li key={r.type}>
                <div className="flex justify-between text-sm"><span>{t(`type.${r.type}` as Key)} <span className="text-muted">· {r.events}</span></span><b>{m(r.pledged)}</b></div>
                <Bar value={r.pledged} max={maxType} className="bg-accent/70" />
                <div className="mt-1"><Bar value={r.collected} max={maxType} /></div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="font-bold">{t('ax.payMethods')}</h2>
          {a.payments.byMethod.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-left text-muted"><th className="py-1">{t('ax.method')}</th><th className="text-right">{t('ax.attempts')}</th><th className="text-right">{t('ax.success')}</th><th className="text-right">{t('ax.amount')}</th></tr></thead>
              <tbody>{a.payments.byMethod.map((x) => (
                <tr key={x.method} className="border-t border-line"><td className="py-1.5 uppercase font-semibold">{x.method}</td><td className="text-right">{x.n}</td><td className="text-right">{x.n ? Math.round((x.ok / x.n) * 100) : 0}%</td><td className="text-right">{m(x.amount)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {a.payments.failures.length > 0 && (
            <>
              <h3 className="font-semibold text-sm mt-4">{t('ax.failures')}</h3>
              <ul className="text-sm mt-1">{a.payments.failures.map((f) => <li key={f.reason} className="flex justify-between py-0.5"><span className="text-muted">{f.reason}</span><b>{f.n}</b></li>)}</ul>
            </>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-bold">{t('ax.topEvents')}</h2>
          {a.top.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
            <ol className="mt-3 space-y-3">
              {a.top.map((r) => (
                <li key={r.id}>
                  <div className="flex justify-between gap-2 text-sm">
                    <Link href={`/app/e/${r.id}`} className="font-semibold underline truncate">{r.title}</Link>
                    <b className="shrink-0">{m(r.collected)}</b>
                  </div>
                  <Bar value={r.collected} max={maxTop} />
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="card p-5">
          <h2 className="font-bold">{t('ax.messages')}</h2>
          {a.messages.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
            <table className="w-full text-sm mt-3">
              <thead><tr className="text-left text-muted"><th className="py-1">{t('ax.channel')}</th><th>{t('ax.status')}</th><th className="text-right">{t('ax.count')}</th></tr></thead>
              <tbody>{a.messages.map((x) => (
                <tr key={`${x.channel}-${x.status}`} className="border-t border-line"><td className="py-1.5">{x.channel}</td><td className={x.status === 'failed' ? 'text-bad font-semibold' : ''}>{x.status}</td><td className="text-right">{x.n}</td></tr>
              ))}</tbody>
            </table>
          )}
          <h3 className="font-semibold text-sm mt-4">{t('ax.byKind')}</h3>
          <ul className="text-sm mt-1">{a.byKind.map((k) => <li key={k.kind} className="flex justify-between py-0.5"><span>{t(`who.${k.kind}` as Key)}</span><b>{k.events}</b></li>)}</ul>
        </section>
      </div>
      <p className="text-xs text-muted">{t('ax.note')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Events */

async function EventsTab({ perms, q }: { perms: Perms; q: string }) {
  const db = await getDb();
  const { t } = getT();
  const term = q.trim();
  // Urgent hospital / funeral events and homepage requests are pinned to the top for fast review.
  const events = await db.query(
    `SELECT e.*, COALESCE(u.phone, u.email) AS owner_phone, u.name AS owner_name FROM events e JOIN users u ON u.id=e.created_by
      WHERE ($1 = '' OR e.title ILIKE '%' || $1 || '%' OR e.slug ILIKE '%' || $1 || '%' OR u.phone ILIKE '%' || $1 || '%')
      ORDER BY (e.show_on_home AND e.home_approved IS NULL) DESC, e.urgent DESC, e.created_at DESC LIMIT 200`,
    [term],
  );
  const rows = await Promise.all(events.map(async (e) => ({ e, totals: await eventTotals(db, e.id) })));
  return (
    <div className="space-y-3">
      <form className="flex gap-2" action="/admin">
        <input type="hidden" name="tab" value="events" />
        <input name="q" defaultValue={term} className="input" placeholder={t('ax.search')} aria-label={t('ax.search')} />
        <button className="btn-outline px-4">{t('ax.find')}</button>
      </form>
      {rows.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-left text-muted border-b border-line">
              <th className="p-3">{t('rc.event')}</th><th className="p-3">{t('ledger.type')}</th><th className="p-3">{t('adm.created')}</th>
              <th className="p-3 text-right">{t('adm.collected')}</th><th className="p-3" />
            </tr></thead>
            <tbody>
              {rows.map(({ e, totals }) => (
                <tr key={e.id} className="border-b border-line/60 align-top">
                  <td className="p-3">
                    <Link className="font-semibold underline" href={`/app/e/${e.id}`}>{e.title}</Link>
                    <div className="text-xs text-muted">{e.owner_name ? `${e.owner_name} · ` : ''}{e.owner_phone?.startsWith('+') ? formatPhone(e.owner_phone) : e.owner_phone} · <a className="underline" href={`/e/${e.slug}`} target="_blank" rel="noopener">{t('ax.publicPage')}</a></div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {e.urgent && <span className="chip bg-bad/15 text-bad">{t('ev.urgent')}</span>}
                      {e.frozen && <span className="chip bg-warn/15 text-warn">{t('adm.freeze')}</span>}
                      {e.verified && <span className="chip bg-ok/15 text-ok">{t('ev.verified')}</span>}
                      {e.status !== 'active' && <span className="chip bg-line text-muted">{t('dash.tab.closed')}</span>}
                      {e.show_on_home && e.home_approved === null && <span className="chip bg-accent/25 text-ink">{t('adm.homeWaiting')}</span>}
                      {e.show_on_home && e.home_approved === true && <span className="chip bg-brand-soft text-brand">{t('adm.homeLive')}</span>}
                    </div>
                  </td>
                  <td className="p-3">{t(`type.${e.type}` as Key)}</td>
                  <td className="p-3 whitespace-nowrap">{new Date(e.created_at).toISOString().slice(0, 10)}</td>
                  <td className="p-3 text-right whitespace-nowrap">{formatMoney(totals.collected, e.currency)}</td>
                  <td className="p-3 text-right space-x-1 space-y-1">
                    {perms['events.freeze'] && <AdminButton action="freeze" body={{ eventId: e.id, frozen: !e.frozen }} label={e.frozen ? t('adm.unfreeze') : t('adm.freeze')} />}
                    {perms['events.verify'] && !e.verified && <AdminButton action="verify-event" body={{ eventId: e.id }} label={t('adm.markVerified')} />}
                    {perms['home.review'] && e.show_on_home && e.home_approved !== true && <AdminButton action="home" body={{ eventId: e.id, approved: true }} label={t('adm.homeApprove')} primary />}
                    {perms['home.review'] && e.show_on_home && e.home_approved === null && <AdminButton action="home" body={{ eventId: e.id, approved: false }} label={t('adm.homeDecline')} />}
                    {perms['home.review'] && e.show_on_home && e.home_approved === true && <AdminButton action="home" body={{ eventId: e.id, approved: false }} label={t('adm.homeRemove')} />}
                    {perms['accounts.recover'] && <ReassignOwner eventId={e.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Queues */

async function FlagsTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const flags = await db.query(`SELECT r.*, e.title, e.slug, e.frozen FROM reports r JOIN events e ON e.id=r.event_id WHERE r.status='open' ORDER BY r.created_at DESC`);
  if (flags.length === 0) return <Empty />;
  return (
    <ul className="grid gap-3">
      {flags.map((f) => (
        <li key={f.id} className="card p-4 flex flex-wrap justify-between gap-3">
          <div>
            <a href={`/e/${f.slug}`} className="font-semibold underline" target="_blank" rel="noopener">{f.title}</a>
            <p className="text-sm">{f.reason}</p>
            <p className="text-xs text-muted">{f.source} · {new Date(f.created_at).toISOString().slice(0, 16).replace('T', ' ')}</p>
          </div>
          <div className="flex gap-2 items-start">
            {perms['events.freeze'] && !f.frozen && <AdminButton action="freeze" body={{ eventId: f.event_id, frozen: true }} label={t('adm.freeze')} />}
            {perms['flags.resolve'] && <AdminButton action="resolve-flag" body={{ reportId: f.id }} label={t('adm.resolve')} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

async function PayoutsTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const rows = await db.query(
    `SELECT p.*, e.title, e.type, e.verified, a.kind, a.phone, a.bank_name, a.account_no, COALESCE(r.name, r.phone) AS requester
       FROM payouts p JOIN events e ON e.id=p.event_id JOIN payout_accounts a ON a.id=p.account_id LEFT JOIN users r ON r.id=p.requested_by
      ORDER BY CASE p.status WHEN 'in_review' THEN 0 ELSE 1 END, e.urgent DESC, p.created_at DESC LIMIT 200`,
  );
  if (rows.length === 0) return <Empty />;
  return (
    <ul className="grid gap-3">
      {rows.map((p) => (
        <li key={p.id} className="card p-4 flex flex-wrap justify-between gap-3">
          <div>
            <p className="font-bold">{formatMoney(Number(p.amount), p.currency)} · {p.title}</p>
            <p className="text-sm text-muted">{p.kind === 'bank' ? `${p.bank_name} ${p.account_no}` : formatPhone(p.phone)} · {t(`type.${p.type}` as Key)} {p.verified ? `· ${t('ev.verified')}` : ''}</p>
            <p className="text-xs text-muted">{t('ax.requestedBy', { who: p.requester?.startsWith?.('+') ? formatPhone(p.requester) : p.requester ?? '—' })} · {new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' ')}</p>
            <p className="text-sm font-semibold">{t(`po.status.${p.status}` as Key)}</p>
          </div>
          {p.status === 'in_review' && perms['payouts.review'] && (
            <div className="flex gap-2 items-start">
              <AdminButton action="payout-review" body={{ payoutId: p.id, approve: true }} label={t('a.approve')} primary />
              <AdminButton action="payout-review" body={{ payoutId: p.id, approve: false }} label={t('a.reject')} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

async function VerificationsTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const rows = await db.query(
    `SELECT v.*, e.title, e.urgent, COALESCE(u.phone, u.email) AS phone FROM verifications v LEFT JOIN events e ON e.id=v.event_id JOIN users u ON u.id=v.user_id
      WHERE v.status='pending' ORDER BY e.urgent DESC NULLS LAST, v.created_at`,
  );
  if (rows.length === 0) return <Empty />;
  return (
    <ul className="grid gap-3">
      {rows.map((v) => (
        <li key={v.id} className="card p-4 flex flex-wrap justify-between gap-3">
          <div>
            <p className="font-semibold">{v.title} {v.urgent && <span className="chip bg-bad/15 text-bad">{t('ev.urgent')}</span>}</p>
            <p className="text-sm text-muted">{t(v.kind === 'organizer_id' ? 'set.verifyKindId' : 'set.verifyKindInvoice')} · {v.phone?.startsWith('+') ? formatPhone(v.phone) : v.phone}</p>
            {v.file_id && <a className="text-sm underline" href={`/api/files/${v.file_id}`} target="_blank" rel="noopener">{t('adm.openFile')}</a>}
          </div>
          {perms['verifications.review'] && (
            <div className="flex gap-2 items-start">
              <AdminButton action="verification" body={{ verificationId: v.id, approve: true }} label={t('a.approve')} primary />
              <AdminButton action="verification" body={{ verificationId: v.id, approve: false }} label={t('a.reject')} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

async function RevenueTab() {
  const db = await getDb();
  const { t } = getT();
  const acc = await db.query<{ account: string; bal: number }>(
    `SELECT account, (-COALESCE(SUM(amount),0))::bigint AS bal FROM ledger_entries WHERE account LIKE 'ahadi_%revenue' GROUP BY account`,
  );
  const v = (a: string) => Number(acc.find((r) => r.account === a)?.bal ?? 0);
  const [{ n: sms }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM messages_log WHERE channel='sms'`);
  const [{ pending }] = await db.query<{ pending: number }>(`SELECT COALESCE(SUM(amount),0)::bigint AS pending FROM payouts WHERE status IN ('awaiting_second_approval','in_review','processing')`);
  const byType = await db.query(
    `SELECT e.type, (-COALESCE(SUM(le.amount),0))::bigint AS fees FROM ledger_entries le JOIN events e ON e.id=le.event_id
      WHERE le.account='ahadi_fee_revenue' GROUP BY e.type ORDER BY 2 DESC`,
  );
  const byWeek = await db.query(
    `SELECT to_char(date_trunc('week', j.created_at AT TIME ZONE 'Africa/Kampala'), 'YYYY-MM-DD') AS week,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_fee_revenue'),0))::bigint AS fees,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_pass_revenue'),0))::bigint AS passes,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_credit_revenue'),0))::bigint AS credits,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_tip_revenue'),0))::bigint AS tips
       FROM ledger_entries le JOIN ledger_journals j ON j.id=le.journal_id WHERE le.account LIKE 'ahadi_%revenue'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
  );
  const cards: [Key, string][] = [
    ['adm.fees', formatMoney(v('ahadi_fee_revenue'))],
    ['adm.passes', formatMoney(v('ahadi_pass_revenue'))],
    ['adm.credits', formatMoney(v('ahadi_credit_revenue'))],
    ['adm.tips', formatMoney(v('ahadi_tip_revenue'))],
    ['adm.smsSent', String(sms)],
    ['adm.payoutsPending', formatMoney(Number(pending))],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(([k, val]) => (
          <div key={k} className="card p-4"><p className="text-sm text-muted">{t(k)}</p><p className="text-xl font-extrabold mt-1">{val}</p></div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card p-4">
          <h2 className="font-bold">{t('adm.byType')}</h2>
          <ul className="mt-2 divide-y divide-line">{byType.map((r) => <li key={r.type} className="py-2 flex justify-between"><span>{t(`type.${r.type}` as Key)}</span><b>{formatMoney(Number(r.fees))}</b></li>)}</ul>
        </section>
        <section className="card p-4 overflow-x-auto">
          <h2 className="font-bold">{t('adm.byWeek')}</h2>
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-left text-muted"><th className="py-1" /><th>{t('adm.fees')}</th><th>{t('adm.passes')}</th><th>{t('adm.credits')}</th><th>{t('adm.tips')}</th></tr></thead>
            <tbody>{byWeek.map((r) => (
              <tr key={r.week} className="border-t border-line"><td className="py-1.5">{r.week}</td><td>{Number(r.fees).toLocaleString()}</td><td>{Number(r.passes).toLocaleString()}</td><td>{Number(r.credits).toLocaleString()}</td><td>{Number(r.tips).toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Settings, recon, audit, team */

async function SettingsTab({ perms, userId }: { perms: Perms; userId: string }) {
  const db = await getDb();
  const { t } = getT();
  const s = await getSettings(db);
  const proposals = await db.query(
    `SELECT p.*, COALESCE(u.name, u.phone, u.email) AS who FROM setting_proposals p JOIN users u ON u.id=p.proposed_by WHERE p.status='pending' ORDER BY p.created_at`,
  );
  const values = s as unknown as Record<string, unknown>;
  return (
    <div className="space-y-4">
      {proposals.length > 0 && (
        <section className="card p-5 border-2 border-accent/60">
          <h2 className="font-bold">{t('ax.proposals')}</h2>
          <p className="text-sm text-muted">{t('ax.proposalsHint')}</p>
          <ul className="mt-3 divide-y divide-line">
            {proposals.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap justify-between gap-2">
                <div className="text-sm">
                  <p className="font-mono font-semibold">{p.key}</p>
                  <p>{JSON.stringify(p.old_value)} → <b>{JSON.stringify(p.value)}</b></p>
                  <p className="text-xs text-muted">{t('ax.proposedBy', { who: String(p.who).startsWith('+') ? formatPhone(p.who) : p.who })}</p>
                </div>
                {perms['settings.approve'] && p.proposed_by !== userId ? (
                  <div className="flex gap-2 items-start">
                    <AdminButton action="setting-decide" body={{ proposalId: p.id, approve: true }} label={t('a.approve')} primary />
                    <AdminButton action="setting-decide" body={{ proposalId: p.id, approve: false }} label={t('a.reject')} />
                  </div>
                ) : <span className="text-xs text-muted self-center">{t('ax.waitingOther')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {perms['settings.edit'] ? (
        <SettingsEditor values={values} keys={Object.keys(DEFAULT_SETTINGS)} moneyKeys={MONEY_SETTINGS} />
      ) : (
        <section className="card p-5">
          <h2 className="font-bold">{t('adm.settings')}</h2>
          <p className="text-sm text-muted">{t('ax.settingsReadOnly')}</p>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
            {Object.keys(DEFAULT_SETTINGS).map((k) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line/60 py-1"><dt className="font-mono text-xs">{k}</dt><dd className="font-semibold">{JSON.stringify(values[k])}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {perms['jobs.run'] && <RunJobs />}
    </div>
  );
}

async function ReconTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const rows = await db.query(`SELECT * FROM reconciliation_issues WHERE resolved=false ORDER BY created_at DESC LIMIT 200`);
  return (
    <div className="space-y-4">
      {rows.length === 0 ? <Empty /> : (
        <ul className="grid gap-3">
          {rows.map((r) => (
            <li key={r.id} className="card p-4 flex flex-wrap justify-between gap-3">
              <div>
                <p className="font-semibold">{r.kind}</p>
                <p className="text-sm text-muted">{r.run_date} · {r.payment_id ?? ''}</p>
                <code className="text-xs break-all">{JSON.stringify(r.details)}</code>
              </div>
              {perms['recon.resolve'] && <AdminButton action="resolve-recon" body={{ issueId: r.id }} label={t('adm.resolve')} />}
            </li>
          ))}
        </ul>
      )}
      {perms['jobs.run'] && <RunJobs />}
    </div>
  );
}

async function AuditTab() {
  const db = await getDb();
  const rows = await db.query(`SELECT a.*, COALESCE(u.phone, u.email) AS phone, u.admin_role FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 300`);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs min-w-[720px]">
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={`border-b border-line/60 align-top ${String(a.action).startsWith('admin.') ? 'bg-accent-soft/40' : ''}`}>
              <td className="p-2 whitespace-nowrap">{new Date(a.created_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
              <td className="p-2 font-semibold">{a.action}</td>
              <td className="p-2">{a.phone ?? 'system'}{a.admin_role ? ` (${a.admin_role})` : ''}</td>
              <td className="p-2">{a.entity_type}:{a.entity_id}</td>
              <td className="p-2 break-all">{JSON.stringify(a.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function TeamTab({ perms, userId }: { perms: Perms; userId: string }) {
  const { t } = getT();
  const admins = await listAdmins(await getDb());
  const roles = ['super', 'finance', 'trust', 'support'] as const;
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.team')}</h2>
        <ul className="mt-3 divide-y divide-line">
          {admins.map((u) => (
            <li key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{u.name ?? (u.phone ? formatPhone(u.phone) : u.email)} {u.id === userId && <span className="text-xs text-muted">({t('com.you')})</span>}</p>
                <p className="text-xs text-muted">{u.phone ? formatPhone(u.phone) : u.email} · {t('ax.lastLogin', { d: u.last_login ? new Date(u.last_login).toISOString().slice(0, 10) : '—' })}</p>
              </div>
              <span className="chip bg-brand-soft text-brand">{t(`ax.role.${u.admin_role ?? 'support'}` as Key)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.rolesTitle')}</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {roles.map((r) => <li key={r}><b>{t(`ax.role.${r}` as Key)}:</b> <span className="text-muted">{t(`ax.role.${r}.d` as Key)}</span></li>)}
        </ul>
      </section>
      {perms['team.manage'] && <TeamForm />}
    </div>
  );
}

/* ------------------------------------------------------------------ Payments, privacy, system */

async function PaymentsTab({ perms, q }: { perms: Perms; q: string }) {
  const db = await getDb();
  const { t } = getT();
  const term = q.trim();
  const digits = term.replace(/\D/g, '');
  const rows = await db.query(
    `SELECT p.id, p.status, p.method, p.purpose, p.charged_amount, p.currency, p.receipt_no, p.created_at, p.payer_phone, p.failure_reason,
            e.title, e.id AS event_id, pg.display_name
       FROM payments p LEFT JOIN events e ON e.id=p.event_id LEFT JOIN pledges pg ON pg.id=p.pledge_id
      WHERE ($1 = '' OR p.receipt_no ILIKE '%' || $1 || '%' OR p.id = $1 OR ($2 <> '' AND p.payer_phone LIKE '%' || $2 || '%') OR e.title ILIKE '%' || $1 || '%')
      ORDER BY p.created_at DESC LIMIT 100`,
    [term, digits.length >= 6 ? digits.slice(-9) : ''],
  );
  const tone: Record<string, string> = { succeeded: 'text-ok', failed: 'text-bad', expired: 'text-muted', refunded: 'text-warn', refunding: 'text-warn', pending: 'text-muted' };
  return (
    <div className="space-y-3">
      <form className="flex gap-2" action="/admin">
        <input type="hidden" name="tab" value="payments" />
        <input name="pq" defaultValue={term} className="input" placeholder={t('ax.paySearch')} aria-label={t('ax.paySearch')} />
        <button className="btn-outline px-4">{t('ax.find')}</button>
      </form>
      <p className="text-xs text-muted">{t('ax.refundHint')}</p>
      {rows.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead><tr className="text-left text-muted border-b border-line">
              <th className="p-3">{t('ledger.date')}</th><th className="p-3">{t('rc.event')}</th><th className="p-3">{t('ax.method')}</th>
              <th className="p-3 text-right">{t('ax.amount')}</th><th className="p-3">{t('ax.status')}</th><th className="p-3" />
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line/60 align-top">
                  <td className="p-3 whitespace-nowrap">{new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td className="p-3">
                    <span className="font-semibold">{p.title ?? t(`ax.purpose.${p.purpose}` as Key)}</span>
                    <span className="block text-xs text-muted">{p.display_name ?? ''}{p.payer_phone ? ` · ${formatPhone(p.payer_phone)}` : ''}{p.receipt_no ? ` · ` : ''}{p.receipt_no && <a className="underline" href={`/r/${p.receipt_no}`} target="_blank" rel="noopener">{p.receipt_no}</a>}</span>
                  </td>
                  <td className="p-3 uppercase">{p.method}</td>
                  <td className="p-3 text-right whitespace-nowrap">{formatMoney(Number(p.charged_amount), p.currency)}</td>
                  <td className={`p-3 font-semibold ${tone[p.status] ?? ''}`}>{p.status}{p.failure_reason ? <span className="block text-xs font-normal text-muted">{p.failure_reason}</span> : null}</td>
                  <td className="p-3 text-right">
                    {perms['payments.refund'] && p.status === 'succeeded' && <AdminButton action="refund" body={{ paymentId: p.id }} label={t('ax.refund')} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function PrivacyTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const [c] = await db.query(
    `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active, COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS erased,
            COUNT(*) FILTER (WHERE consent_version = $1)::int AS current_version FROM pledgers`, [PRIVACY_VERSION]);
  const versions = await db.query(`SELECT COALESCE(consent_version, 'unknown') AS v, COUNT(*)::int AS n FROM pledgers WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 1 DESC`);
  const recent = await db.query(`SELECT a.created_at, a.details, COALESCE(u.phone, 'self') AS who FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.action='pledger.deleted' ORDER BY a.id DESC LIMIT 20`);
  const [last] = await db.query(`SELECT created_at, details FROM ops_runs WHERE kind='retention' ORDER BY created_at DESC LIMIT 1`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t('ax.pledgersActive')} value={String(c.active)} />
        <Kpi label={t('ax.consentCurrent')} value={String(c.current_version)} sub={t('ax.version', { v: PRIVACY_VERSION })} />
        <Kpi label={t('ax.erasedCount')} value={String(c.erased)} />
        <Kpi label={t('ax.lastCleanup')} value={last ? new Date(last.created_at).toISOString().slice(0, 10) : '—'} />
      </div>
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.retentionTitle')}</h2>
        <ul className="text-sm mt-2 space-y-1">
          <li>{t('ax.ret.codes', { d: RETENTION.otpCodesDays })}</li>
          <li>{t('ax.ret.visits', { d: RETENTION.pledgerVisitsDays })}</li>
          <li>{t('ax.ret.messages', { d: RETENTION.messageBodiesDays })}</li>
          <li>{t('ax.ret.webhooks', { d: RETENTION.webhookPayloadsDays })}</li>
          <li>{t('ax.ret.money')}</li>
        </ul>
        <h3 className="font-semibold text-sm mt-4">{t('ax.consentVersions')}</h3>
        <ul className="text-sm">{versions.map((v) => <li key={v.v} className="flex justify-between max-w-sm"><span>{v.v}</span><b>{v.n}</b></li>)}</ul>
      </section>
      {perms['privacy.erase'] && <EraseForm />}
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.erasedLog')}</h2>
        {recent.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
          <ul className="text-sm mt-2 divide-y divide-line">
            {recent.map((r, i) => <li key={i} className="py-1.5 flex justify-between"><span>{new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}</span><span className="text-muted">{r.details?.via === 'admin' ? formatPhone(r.who) : t('ax.bySelf')}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

async function SystemTab({ perms }: { perms: Perms }) {
  const db = await getDb();
  const { t } = getT();
  const h = await health(db);
  const runs = await opsRuns(db, 20);
  const usingEmbedded = !process.env.DATABASE_URL;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t('ax.health')} value={h.ok ? t('ax.healthy') : t('ax.down')} sub={t('ax.dbMs', { ms: h.dbMs })} tone={h.ok ? 'brand' : 'bad'} />
        <Kpi label={t('ax.database')} value={usingEmbedded ? t('ax.dbEmbedded') : 'PostgreSQL'} sub={t('ax.schema', { s: h.schema ?? '—' })} tone={usingEmbedded ? 'warn' : undefined} />
        <Kpi label={t('ax.lastBackup')} value={h.lastBackup ? new Date(h.lastBackup).toISOString().slice(0, 16).replace('T', ' ') : '—'} sub={h.lastBackupOk === false ? t('ax.backupFailed') : t('ax.backupKeep', { n: BACKUP_KEEP })} tone={h.lastBackupOk === false ? 'bad' : undefined} />
        <Kpi label={t('ax.alerts')} value={process.env.ALERT_WEBHOOK_URL ? t('ax.alertsOn') : t('ax.alertsOff')} sub={t('ax.alertsSub')} tone={process.env.ALERT_WEBHOOK_URL ? undefined : 'warn'} />
      </div>
      <section className="card p-5 space-y-2">
        <h2 className="font-bold">{t('ax.opsTitle')}</h2>
        <p className="text-sm text-muted">{t('ax.opsHint', { dir: usingEmbedded ? backupDir() : '—' })}</p>
        <p className="text-sm text-muted">{t('ax.healthHint')}</p>
        {perms['ops.run'] && (
          <div className="flex flex-wrap gap-2 pt-1">
            <OpsButton action="backup-now" label={t('ax.backupNow')} />
            <OpsButton action="retention-now" label={t('ax.cleanupNow')} />
          </div>
        )}
      </section>
      <section className="card p-5">
        <h2 className="font-bold">{t('ax.opsRuns')}</h2>
        {runs.length === 0 ? <p className="text-muted mt-2">{t('adm.none')}</p> : (
          <table className="w-full text-xs mt-2">
            <tbody>{runs.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="pr-3 font-semibold">{r.kind}</td>
                <td className={`pr-3 ${r.ok ? 'text-ok' : 'text-bad'}`}>{r.ok ? 'ok' : 'failed'}</td>
                <td className="break-all">{JSON.stringify(r.details)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
