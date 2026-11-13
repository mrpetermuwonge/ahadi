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
import { AdminButton, SettingsEditor, RunJobs } from './AdminClient';
import { Alert } from '@/components/Ui';
import { codesOnScreen } from '@/lib/services/auth';
import type { Key } from '@/i18n';

export const metadata = { title: 'Admin', robots: { index: false } };

const TABS = ['events', 'flags', 'payouts', 'verifications', 'revenue', 'settings', 'recon', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_KEY: Record<Tab, Key> = {
  events: 'adm.events', flags: 'adm.flags', payouts: 'adm.payouts', verifications: 'adm.verifications',
  revenue: 'adm.revenue', settings: 'adm.settings', recon: 'adm.recon', audit: 'adm.audit',
};

export default async function AdminPage({ searchParams }: { searchParams: { tab?: string } }) {
  await requireAdmin();
  const { t } = getT();
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as Tab) : 'events';
  return (
    <div className="min-h-screen">
      <header className="border-b border-line/60 bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3"><Logo /><span className="chip bg-accent/20 text-ink">{t('adm.title')}</span></div>
          <div className="flex items-center gap-2"><LangSwitcher /><Link href="/app" className="btn-ghost min-h-[40px] px-3 text-sm">{t('nav.events')}</Link></div>
        </div>
        <nav className="mx-auto max-w-6xl px-4 overflow-x-auto">
          <ul className="flex gap-1 min-w-max">
            {TABS.map((x) => (
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
        {tab === 'events' && <EventsTab />}
        {tab === 'flags' && <FlagsTab />}
        {tab === 'payouts' && <PayoutsTab />}
        {tab === 'verifications' && <VerificationsTab />}
        {tab === 'revenue' && <RevenueTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'recon' && <ReconTab />}
        {tab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}

function Empty() {
  const { t } = getT();
  return <p className="card p-6 text-muted text-center">{t('adm.none')}</p>;
}

async function EventsTab() {
  const db = await getDb();
  const { t } = getT();
  // Urgent hospital / funeral events are pinned to the top for fast review.
  const events = await db.query(`SELECT e.*, COALESCE(u.phone, u.email) AS owner_phone FROM events e JOIN users u ON u.id=e.created_by
      ORDER BY (e.show_on_home AND e.home_approved IS NULL) DESC, e.urgent DESC, e.created_at DESC LIMIT 200`);
  if (events.length === 0) return <Empty />;
  const rows = await Promise.all(events.map(async (e) => ({ e, totals: await eventTotals(db, e.id) })));
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead><tr className="text-left text-muted border-b border-line">
          <th className="p-3">{t('rc.event')}</th><th className="p-3">{t('ledger.type')}</th><th className="p-3">{t('adm.created')}</th>
          <th className="p-3 text-right">{t('adm.collected')}</th><th className="p-3" />
        </tr></thead>
        <tbody>
          {rows.map(({ e, totals }) => (
            <tr key={e.id} className="border-b border-line/60 align-top">
              <td className="p-3">
                <a className="font-semibold underline" href={`/e/${e.slug}`} target="_blank" rel="noopener">{e.title}</a>
                <div className="text-xs text-muted">{e.owner_phone?.startsWith('+') ? formatPhone(e.owner_phone) : e.owner_phone}</div>
                <div className="flex gap-1 mt-1">
                  {e.urgent && <span className="chip bg-bad/15 text-bad">{t('ev.urgent')}</span>}
                  {e.frozen && <span className="chip bg-warn/15 text-warn">{t('adm.freeze')}</span>}
                  {e.verified && <span className="chip bg-ok/15 text-ok">{t('ev.verified')}</span>}
                  {e.show_on_home && e.home_approved === null && <span className="chip bg-accent/25 text-ink">{t('adm.homeWaiting')}</span>}
                  {e.show_on_home && e.home_approved === true && <span className="chip bg-brand-soft text-brand">{t('adm.homeLive')}</span>}
                </div>
              </td>
              <td className="p-3">{t(`type.${e.type}` as Key)}</td>
              <td className="p-3 whitespace-nowrap">{new Date(e.created_at).toISOString().slice(0, 10)}</td>
              <td className="p-3 text-right whitespace-nowrap">{formatMoney(totals.collected, e.currency)}</td>
              <td className="p-3 text-right space-x-1 space-y-1">
                <AdminButton action="freeze" body={{ eventId: e.id, frozen: !e.frozen }} label={e.frozen ? t('adm.unfreeze') : t('adm.freeze')} />
                {!e.verified && <AdminButton action="verify-event" body={{ eventId: e.id }} label={t('adm.markVerified')} />}
                {e.show_on_home && e.home_approved !== true && <AdminButton action="home" body={{ eventId: e.id, approved: true }} label={t('adm.homeApprove')} primary />}
                {e.show_on_home && e.home_approved === null && <AdminButton action="home" body={{ eventId: e.id, approved: false }} label={t('adm.homeDecline')} />}
                {e.show_on_home && e.home_approved === true && <AdminButton action="home" body={{ eventId: e.id, approved: false }} label={t('adm.homeRemove')} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function FlagsTab() {
  const db = await getDb();
  const { t } = getT();
  const flags = await db.query(`SELECT r.*, e.title, e.slug FROM reports r JOIN events e ON e.id=r.event_id WHERE r.status='open' ORDER BY r.created_at DESC`);
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
            <AdminButton action="freeze" body={{ eventId: f.event_id, frozen: true }} label={t('adm.freeze')} />
            <AdminButton action="resolve-flag" body={{ reportId: f.id }} label={t('adm.resolve')} />
          </div>
        </li>
      ))}
    </ul>
  );
}

async function PayoutsTab() {
  const db = await getDb();
  const { t } = getT();
  const rows = await db.query(
    `SELECT p.*, e.title, e.type, e.verified, a.kind, a.phone, a.bank_name, a.account_no FROM payouts p JOIN events e ON e.id=p.event_id
       JOIN payout_accounts a ON a.id=p.account_id ORDER BY CASE p.status WHEN 'in_review' THEN 0 ELSE 1 END, e.urgent DESC, p.created_at DESC LIMIT 200`,
  );
  if (rows.length === 0) return <Empty />;
  return (
    <ul className="grid gap-3">
      {rows.map((p) => (
        <li key={p.id} className="card p-4 flex flex-wrap justify-between gap-3">
          <div>
            <p className="font-bold">{formatMoney(Number(p.amount), p.currency)} · {p.title}</p>
            <p className="text-sm text-muted">{p.kind === 'bank' ? `${p.bank_name} ${p.account_no}` : formatPhone(p.phone)} · {t(`type.${p.type}` as Key)} {p.verified ? `· ${t('ev.verified')}` : ''}</p>
            <p className="text-sm font-semibold">{t(`po.status.${p.status}` as Key)}</p>
          </div>
          {p.status === 'in_review' && (
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

async function VerificationsTab() {
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
          <div className="flex gap-2 items-start">
            <AdminButton action="verification" body={{ verificationId: v.id, approve: true }} label={t('a.approve')} primary />
            <AdminButton action="verification" body={{ verificationId: v.id, approve: false }} label={t('a.reject')} />
          </div>
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

async function SettingsTab() {
  const db = await getDb();
  const s = await getSettings(db);
  return (
    <div className="space-y-4">
      <SettingsEditor values={s as unknown as Record<string, unknown>} keys={Object.keys(DEFAULT_SETTINGS)} />
      <RunJobs />
    </div>
  );
}

async function ReconTab() {
  const db = await getDb();
  const { t } = getT();
  const rows = await db.query(`SELECT * FROM reconciliation_issues WHERE resolved=false ORDER BY created_at DESC LIMIT 200`);
  if (rows.length === 0) return <div className="space-y-4"><Empty /><RunJobs /></div>;
  return (
    <div className="space-y-4">
      <ul className="grid gap-3">
        {rows.map((r) => (
          <li key={r.id} className="card p-4 flex flex-wrap justify-between gap-3">
            <div>
              <p className="font-semibold">{r.kind}</p>
              <p className="text-sm text-muted">{r.run_date} · {r.payment_id ?? ''}</p>
              <code className="text-xs break-all">{JSON.stringify(r.details)}</code>
            </div>
            <AdminButton action="resolve-recon" body={{ issueId: r.id }} label={t('adm.resolve')} />
          </li>
        ))}
      </ul>
      <RunJobs />
    </div>
  );
}

async function AuditTab() {
  const db = await getDb();
  const rows = await db.query(`SELECT a.*, COALESCE(u.phone, u.email) AS phone FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.id DESC LIMIT 300`);
  if (rows.length === 0) return <Empty />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-xs min-w-[720px]">
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-b border-line/60 align-top">
              <td className="p-2 whitespace-nowrap">{new Date(a.created_at).toISOString().slice(0, 19).replace('T', ' ')}</td>
              <td className="p-2 font-semibold">{a.action}</td>
              <td className="p-2">{a.phone ?? 'system'}</td>
              <td className="p-2">{a.entity_type}:{a.entity_id}</td>
              <td className="p-2 break-all">{JSON.stringify(a.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
