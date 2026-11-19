import type { Db } from '../db';

/**
 * Platform analytics for Ahadi staff. Every money figure comes from the double-entry ledger (the same source as
 * organizer dashboards and exports), so the numbers always agree. Amounts are in the main currency (UGX).
 * `days` is the reporting period; "now" figures (outstanding, queues) ignore the period.
 */
export async function platformAnalytics(db: Db, days: number) {
  const P = String(days);
  const one = async <T extends Record<string, any> = any>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args))[0];

  const money = await one<{ pledged: number; collected: number; collected_offline: number }>(
    `SELECT (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='pledge_income'),0))::bigint AS pledged,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind='manual_payment'),0))::bigint AS collected_offline
       FROM ledger_journals j JOIN ledger_entries le ON le.journal_id=j.id
      WHERE j.created_at > now() - ($1 || ' days')::interval`, [P]);

  const allTime = await one<{ pledged: number; receivable: number; organizer_cash: number; paid_out: number; payout_pending: number }>(
    `SELECT (-COALESCE(SUM(amount) FILTER (WHERE account='pledge_income'),0))::bigint AS pledged,
            COALESCE(SUM(amount) FILTER (WHERE account='receivable'),0)::bigint AS receivable,
            COALESCE(SUM(amount) FILTER (WHERE account='organizer_cash'),0)::bigint AS organizer_cash,
            COALESCE(SUM(amount) FILTER (WHERE account='paid_out'),0)::bigint AS paid_out,
            COALESCE(SUM(amount) FILTER (WHERE account='payout_pending'),0)::bigint AS payout_pending
       FROM ledger_entries`);
  const outstanding = await one<{ owed: number }>(
    `SELECT COALESCE(SUM(GREATEST(bal,0)),0)::bigint AS owed FROM
       (SELECT pledge_id, SUM(amount) AS bal FROM ledger_entries WHERE account='receivable' GROUP BY pledge_id) x`);

  const revenue = await db.query<{ account: string; amt: number }>(
    `SELECT le.account, (-COALESCE(SUM(le.amount),0))::bigint AS amt FROM ledger_entries le JOIN ledger_journals j ON j.id=le.journal_id
      WHERE le.account LIKE 'ahadi_%revenue' AND j.created_at > now() - ($1 || ' days')::interval GROUP BY le.account`, [P]);
  const rev = (a: string) => Number(revenue.find((r) => r.account === a)?.amt ?? 0);

  const events = await one<{ created: number; active: number; frozen: number; verified: number; urgent: number; on_home: number; closed: number }>(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - ($1 || ' days')::interval)::int AS created,
            COUNT(*) FILTER (WHERE status='active' AND NOT frozen)::int AS active,
            COUNT(*) FILTER (WHERE frozen)::int AS frozen,
            COUNT(*) FILTER (WHERE verified)::int AS verified,
            COUNT(*) FILTER (WHERE urgent AND status='active')::int AS urgent,
            COUNT(*) FILTER (WHERE show_on_home AND home_approved)::int AS on_home,
            COUNT(*) FILTER (WHERE status='closed')::int AS closed
       FROM events`, [P]);

  const pledges = await one<{ n: number; people: number; avg: number; fully_paid: number; part_paid: number }>(
    `WITH p AS (
       SELECT pg.id, pg.pledger_id,
              (SELECT -COALESCE(SUM(le.amount),0) FROM ledger_entries le WHERE le.pledge_id=pg.id AND le.account='pledge_income') AS amount,
              (SELECT COALESCE(SUM(le.amount),0) FROM ledger_entries le WHERE le.pledge_id=pg.id AND le.account='receivable') AS bal
         FROM pledges pg WHERE pg.disputed_at IS NULL AND pg.created_at > now() - ($1 || ' days')::interval)
     SELECT COUNT(*)::int AS n, COUNT(DISTINCT pledger_id)::int AS people, COALESCE(AVG(amount),0)::bigint AS avg,
            COUNT(*) FILTER (WHERE bal <= 0)::int AS fully_paid,
            COUNT(*) FILTER (WHERE bal > 0 AND bal < amount)::int AS part_paid
       FROM p`, [P]);

  const people = await one<{ organizers: number; new_organizers: number; pledgers: number; new_users: number; admins: number }>(
    `SELECT (SELECT COUNT(DISTINCT user_id) FROM event_members WHERE role='owner')::int AS organizers,
            (SELECT COUNT(DISTINCT e.created_by) FROM events e WHERE e.created_at > now() - ($1 || ' days')::interval)::int AS new_organizers,
            (SELECT COUNT(*) FROM pledgers)::int AS pledgers,
            (SELECT COUNT(*) FROM users WHERE created_at > now() - ($1 || ' days')::interval)::int AS new_users,
            (SELECT COUNT(*) FROM users WHERE is_admin)::int AS admins`, [P]);

  const payMethods = await db.query<{ method: string; n: number; ok: number; amount: number }>(
    `SELECT method, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status='succeeded')::int AS ok,
            COALESCE(SUM(charged_amount) FILTER (WHERE status='succeeded'),0)::bigint AS amount
       FROM payments WHERE created_at > now() - ($1 || ' days')::interval GROUP BY method ORDER BY 2 DESC`, [P]);
  const failures = await db.query<{ reason: string; n: number }>(
    `SELECT COALESCE(failure_reason, status) AS reason, COUNT(*)::int AS n FROM payments
      WHERE status IN ('failed','expired') AND created_at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 5`, [P]);

  const payouts = await one<{ paid: number; paid_n: number; in_review: number; awaiting: number; failed: number }>(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status='paid' AND updated_at > now() - ($1 || ' days')::interval),0)::bigint AS paid,
            COUNT(*) FILTER (WHERE status='paid' AND updated_at > now() - ($1 || ' days')::interval)::int AS paid_n,
            COUNT(*) FILTER (WHERE status='in_review')::int AS in_review,
            COUNT(*) FILTER (WHERE status='awaiting_second_approval')::int AS awaiting,
            COUNT(*) FILTER (WHERE status='failed')::int AS failed
       FROM payouts`, [P]);

  const queue = await one<{ flags: number; verifications: number; home: number; recon: number; proposals: number }>(
    `SELECT (SELECT COUNT(*) FROM reports WHERE status='open')::int AS flags,
            (SELECT COUNT(*) FROM verifications WHERE status='pending')::int AS verifications,
            (SELECT COUNT(*) FROM events WHERE show_on_home AND home_approved IS NULL)::int AS home,
            (SELECT COUNT(*) FROM reconciliation_issues WHERE NOT resolved)::int AS recon,
            (SELECT COUNT(*) FROM setting_proposals WHERE status='pending')::int AS proposals`);

  const messages = await db.query<{ channel: string; status: string; n: number }>(
    `SELECT channel, status, COUNT(*)::int AS n FROM messages_log WHERE created_at > now() - ($1 || ' days')::interval GROUP BY 1, 2 ORDER BY 1, 2`, [P]);

  const daily = await db.query<{ day: string; pledged: number; collected: number }>(
    `SELECT to_char(j.created_at AT TIME ZONE 'Africa/Kampala', 'YYYY-MM-DD') AS day,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='pledge_income'),0))::bigint AS pledged,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected
       FROM ledger_journals j JOIN ledger_entries le ON le.journal_id=j.id
      WHERE j.created_at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`, [P]);

  const byType = await db.query<{ type: string; events: number; pledged: number; collected: number }>(
    `SELECT e.type, COUNT(DISTINCT e.id)::int AS events,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='pledge_income'),0))::bigint AS pledged,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected
       FROM events e LEFT JOIN ledger_entries le ON le.event_id=e.id LEFT JOIN ledger_journals j ON j.id=le.journal_id
      GROUP BY e.type ORDER BY 3 DESC`);
  const byKind = await db.query<{ kind: string; events: number }>(
    `SELECT organizer_kind AS kind, COUNT(*)::int AS events FROM events GROUP BY 1 ORDER BY 2 DESC`);

  const top = await db.query<{ id: string; title: string; type: string; slug: string; collected: number; pledged: number; frozen: boolean; verified: boolean }>(
    `SELECT e.id, e.title, e.type, e.slug, e.frozen, e.verified,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='pledge_income'),0))::bigint AS pledged,
            (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected
       FROM events e JOIN ledger_entries le ON le.event_id=e.id JOIN ledger_journals j ON j.id=le.journal_id
      WHERE j.created_at > now() - ($1 || ' days')::interval
      GROUP BY e.id ORDER BY collected DESC, pledged DESC LIMIT 10`, [P]);

  const pledgedAll = Number(allTime.pledged);
  const collectedAll = pledgedAll - Number(allTime.receivable);
  const attempts = payMethods.reduce((s, m) => s + m.n, 0);
  const succeeded = payMethods.reduce((s, m) => s + m.ok, 0);

  return {
    days,
    money: {
      pledged: Number(money.pledged),
      collected: Number(money.collected),
      collectedOffline: Number(money.collected_offline),
      pledgedAllTime: pledgedAll,
      collectedAllTime: collectedAll,
      collectionRate: pledgedAll > 0 ? Math.round((collectedAll / pledgedAll) * 100) : 0,
      outstanding: Number(outstanding.owed),
      heldForOrganizers: Number(allTime.organizer_cash),
      paidOutAllTime: Number(allTime.paid_out),
      payoutPending: Number(allTime.payout_pending),
    },
    revenue: {
      fees: rev('ahadi_fee_revenue'), passes: rev('ahadi_pass_revenue'), credits: rev('ahadi_credit_revenue'), tips: rev('ahadi_tip_revenue'),
      total: rev('ahadi_fee_revenue') + rev('ahadi_pass_revenue') + rev('ahadi_credit_revenue') + rev('ahadi_tip_revenue'),
    },
    events,
    pledges: { ...pledges, avg: Number(pledges.avg), fullyPaidRate: pledges.n ? Math.round((pledges.fully_paid / pledges.n) * 100) : 0 },
    people,
    payments: { attempts, succeeded, successRate: attempts ? Math.round((succeeded / attempts) * 100) : 0, byMethod: payMethods.map((m) => ({ ...m, amount: Number(m.amount) })), failures },
    payouts: { ...payouts, paid: Number(payouts.paid) },
    queue,
    messages,
    daily: daily.map((d) => ({ day: d.day, pledged: Number(d.pledged), collected: Number(d.collected) })),
    byType: byType.map((r) => ({ ...r, pledged: Number(r.pledged), collected: Number(r.collected) })),
    byKind,
    top: top.map((r) => ({ ...r, pledged: Number(r.pledged), collected: Number(r.collected) })),
  };
}

export type PlatformAnalytics = Awaited<ReturnType<typeof platformAnalytics>>;

/** CSV of the analytics for finance and reporting (one section per block). */
export function analyticsCsv(a: PlatformAnalytics): string {
  const rows: (string | number)[][] = [['section', 'metric', 'value']];
  for (const [k, v] of Object.entries(a.money)) rows.push(['money', k, v]);
  for (const [k, v] of Object.entries(a.revenue)) rows.push(['revenue', k, v]);
  for (const [k, v] of Object.entries(a.events)) rows.push(['events', k, v]);
  for (const [k, v] of Object.entries(a.pledges)) rows.push(['pledges', k, v]);
  for (const [k, v] of Object.entries(a.people)) rows.push(['people', k, v]);
  for (const m of a.payments.byMethod) rows.push(['payments', `${m.method} attempts/succeeded/amount`, `${m.n}/${m.ok}/${m.amount}`]);
  for (const [k, v] of Object.entries(a.payouts)) rows.push(['payouts', k, v]);
  for (const d of a.daily) rows.push(['daily', d.day, `${d.pledged}/${d.collected}`]);
  for (const r of a.byType) rows.push(['by_type', r.type, `${r.events}/${r.pledged}/${r.collected}`]);
  for (const r of a.top) rows.push(['top_events', r.title, r.collected]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
