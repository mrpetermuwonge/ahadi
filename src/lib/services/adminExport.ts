import ExcelJS from 'exceljs';
import type { Db } from '../db';
import { maskPhone } from '../phone';
import type { AdminRole } from '../adminPermissions';
import { analyticsCsv, platformAnalytics } from './adminAnalytics';

/**
 * Admin data export: staff pick WHICH data they need (events, pledges, payments, …), a date range and an event
 * type, instead of one fixed report. Each dataset says which staff roles may take it. Phone numbers are hidden
 * (0772 *** 456) unless a Super admin or Finance asks for them; every export is audit-logged by the API.
 */
export interface ExportFilters {
  from: string | null; // YYYY-MM-DD, inclusive
  to: string | null; // YYYY-MM-DD, inclusive
  type: string | null; // event type
  phones: boolean; // full phone numbers
}

type Col = { key: string; header: string; width?: number; money?: boolean; phone?: boolean };
interface Dataset {
  key: string;
  roles: AdminRole[];
  personal: boolean; // contains personal data (needs a fresh code)
  cols: Col[];
  load: (db: Db, f: ExportFilters) => Promise<Record<string, unknown>[]>;
}

/** Date-range and event-type conditions shared by most queries ($1 from, $2 to, $3 type). */
const range = (col: string) =>
  `($1::date IS NULL OR ${col} >= $1::date) AND ($2::date IS NULL OR ${col} < ($2::date + 1))`;
const typeOk = (col: string) => `($3::text IS NULL OR ${col} = $3)`;
const args = (f: ExportFilters) => [f.from, f.to, f.type];

export const DATASETS: Dataset[] = [
  {
    key: 'events', roles: ['super', 'finance', 'trust'], personal: true,
    cols: [
      { key: 'created', header: 'Created', width: 12 }, { key: 'title', header: 'Event', width: 34 }, { key: 'type', header: 'Type' },
      { key: 'organizer_kind', header: 'Organizer type' }, { key: 'status', header: 'Status' }, { key: 'frozen', header: 'Frozen' },
      { key: 'verified', header: 'Verified' }, { key: 'urgent', header: 'Urgent' }, { key: 'event_date', header: 'Event date', width: 12 },
      { key: 'organizer', header: 'Organizer', width: 22 }, { key: 'organizer_phone', header: 'Organizer phone', width: 16, phone: true },
      { key: 'pledges', header: 'Pledges' }, { key: 'pledged', header: 'Pledged', money: true }, { key: 'collected', header: 'Collected', money: true },
      { key: 'target', header: 'Target', money: true }, { key: 'available', header: 'Available to withdraw', money: true },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(e.created_at,'YYYY-MM-DD') AS created, e.title, e.type, e.organizer_kind, e.status, e.frozen, e.verified, e.urgent,
              e.event_date::text AS event_date, u.name AS organizer, u.phone AS organizer_phone, e.target_amount AS target,
              (SELECT COUNT(*) FROM pledges p WHERE p.event_id=e.id)::int AS pledges,
              (-COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.event_id=e.id AND le.account='pledge_income'),0))::bigint AS pledged,
              (-COALESCE((SELECT SUM(le.amount) FROM ledger_entries le JOIN ledger_journals j ON j.id=le.journal_id
                  WHERE le.event_id=e.id AND le.account='receivable' AND j.kind IN ('payment','manual_payment')),0))::bigint AS collected,
              COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.event_id=e.id AND le.account='organizer_cash'),0)::bigint AS available
         FROM events e JOIN users u ON u.id=e.created_by
        WHERE ${range('e.created_at')} AND ${typeOk('e.type')} ORDER BY e.created_at DESC`, args(f)),
  },
  {
    key: 'pledges', roles: ['super', 'finance'], personal: true,
    cols: [
      { key: 'created', header: 'Pledged on', width: 12 }, { key: 'event', header: 'Event', width: 30 }, { key: 'name', header: 'Pledger', width: 22 },
      { key: 'phone', header: 'Phone', width: 16, phone: true }, { key: 'amount', header: 'Amount', money: true }, { key: 'paid', header: 'Paid', money: true },
      { key: 'balance', header: 'Still owed', money: true }, { key: 'plan', header: 'Plan' }, { key: 'due', header: 'Due date', width: 12 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(p.created_at,'YYYY-MM-DD') AS created, e.title AS event, p.display_name AS name, pl.phone, p.amount, p.pay_plan AS plan,
              p.due_date::text AS due,
              GREATEST(COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.pledge_id=p.id AND le.account='receivable'),0),0)::bigint AS balance,
              (p.amount - GREATEST(COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.pledge_id=p.id AND le.account='receivable'),0),0))::bigint AS paid
         FROM pledges p JOIN events e ON e.id=p.event_id JOIN pledgers pl ON pl.id=p.pledger_id
        WHERE ${range('p.created_at')} AND ${typeOk('e.type')} ORDER BY p.created_at DESC`, args(f)),
  },
  {
    key: 'payments', roles: ['super', 'finance'], personal: true,
    cols: [
      { key: 'created', header: 'Date', width: 17 }, { key: 'receipt_no', header: 'Receipt', width: 14 }, { key: 'event', header: 'Event', width: 30 },
      { key: 'purpose', header: 'Purpose' }, { key: 'provider', header: 'Provider' }, { key: 'method', header: 'Method' }, { key: 'status', header: 'Status' },
      { key: 'charged', header: 'Charged', money: true }, { key: 'credit', header: 'To the event', money: true }, { key: 'fee', header: 'Ahadi fee', money: true },
      { key: 'tip', header: 'Tip', money: true }, { key: 'payer_phone', header: 'Payer phone', width: 16, phone: true }, { key: 'failure', header: 'Failure reason', width: 22 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(p.created_at,'YYYY-MM-DD HH24:MI') AS created, p.receipt_no, e.title AS event, p.purpose, p.provider, p.method, p.status,
              p.charged_amount AS charged, p.pledge_credit AS credit, p.fee, p.tip, p.payer_phone, p.failure_reason AS failure
         FROM payments p LEFT JOIN events e ON e.id=p.event_id
        WHERE ${range('p.created_at')} AND ($3::text IS NULL OR e.type = $3) ORDER BY p.created_at DESC`, args(f)),
  },
  {
    key: 'payouts', roles: ['super', 'finance'], personal: true,
    cols: [
      { key: 'created', header: 'Requested', width: 17 }, { key: 'event', header: 'Event', width: 30 }, { key: 'amount', header: 'Amount', money: true },
      { key: 'status', header: 'Status', width: 18 }, { key: 'destination', header: 'Paid to', width: 18, phone: true },
      { key: 'requested_by', header: 'Requested by', width: 20 }, { key: 'second', header: 'Second approval', width: 20 }, { key: 'reviewer', header: 'Reviewed by (Ahadi)', width: 20 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(p.created_at,'YYYY-MM-DD HH24:MI') AS created, e.title AS event, p.amount, p.status,
              COALESCE(a.phone, a.bank_name || ' ' || a.account_no) AS destination,
              COALESCE(r.name, r.phone) AS requested_by, COALESCE(s.name, s.phone) AS second, COALESCE(v.name, v.phone) AS reviewer
         FROM payouts p JOIN events e ON e.id=p.event_id JOIN payout_accounts a ON a.id=p.account_id
         LEFT JOIN users r ON r.id=p.requested_by LEFT JOIN users s ON s.id=p.second_approver LEFT JOIN users v ON v.id=p.reviewed_by
        WHERE ${range('p.created_at')} AND ${typeOk('e.type')} ORDER BY p.created_at DESC`, args(f)),
  },
  {
    key: 'refunds', roles: ['super', 'finance'], personal: false,
    cols: [
      { key: 'created', header: 'Refunded', width: 17 }, { key: 'receipt_no', header: 'Receipt', width: 14 }, { key: 'event', header: 'Event', width: 30 },
      { key: 'amount', header: 'Amount', money: true }, { key: 'reason', header: 'Reason', width: 34 }, { key: 'by', header: 'By', width: 20 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(a.created_at,'YYYY-MM-DD HH24:MI') AS created, p.receipt_no, e.title AS event, p.charged_amount AS amount,
              a.details->>'reason' AS reason, COALESCE(u.name, u.phone) AS by
         FROM audit_logs a JOIN payments p ON p.id=a.entity_id LEFT JOIN events e ON e.id=p.event_id LEFT JOIN users u ON u.id=a.actor_user_id
        WHERE a.action='payment.refunded' AND ${range('a.created_at')} AND ($3::text IS NULL OR e.type = $3) ORDER BY a.created_at DESC`, args(f)),
  },
  {
    key: 'revenue', roles: ['super', 'finance'], personal: false,
    cols: [
      { key: 'day', header: 'Day', width: 12 }, { key: 'fees', header: 'Fees', money: true }, { key: 'passes', header: 'Event passes', money: true },
      { key: 'credits', header: 'Message credits', money: true }, { key: 'tips', header: 'Tips', money: true }, { key: 'total', header: 'Total', money: true },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(j.created_at AT TIME ZONE 'Africa/Kampala','YYYY-MM-DD') AS day,
              (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_fee_revenue'),0))::bigint AS fees,
              (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_pass_revenue'),0))::bigint AS passes,
              (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_credit_revenue'),0))::bigint AS credits,
              (-COALESCE(SUM(le.amount) FILTER (WHERE le.account='ahadi_tip_revenue'),0))::bigint AS tips,
              (-COALESCE(SUM(le.amount),0))::bigint AS total
         FROM ledger_entries le JOIN ledger_journals j ON j.id=le.journal_id LEFT JOIN events e ON e.id=le.event_id
        WHERE le.account LIKE 'ahadi_%revenue' AND ${range('j.created_at')} AND ($3::text IS NULL OR e.type = $3)
        GROUP BY 1 ORDER BY 1 DESC`, args(f)),
  },
  {
    key: 'accounts', roles: ['super'], personal: true,
    cols: [
      { key: 'created', header: 'Joined', width: 12 }, { key: 'name', header: 'Name', width: 22 }, { key: 'phone', header: 'Phone', width: 16, phone: true },
      { key: 'email', header: 'Email', width: 24 }, { key: 'owns', header: 'Events organised' }, { key: 'committee', header: 'Committee roles' },
      { key: 'admin_role', header: 'Ahadi staff role' }, { key: 'suspended', header: 'Suspended' }, { key: 'last_login', header: 'Last login', width: 12 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(u.created_at,'YYYY-MM-DD') AS created, u.name, u.phone, u.email, u.admin_role, (u.suspended_at IS NOT NULL) AS suspended,
              (SELECT COUNT(*) FROM event_members m WHERE m.user_id=u.id AND m.role='owner')::int AS owns,
              (SELECT COUNT(*) FROM event_members m WHERE m.user_id=u.id AND m.role<>'owner')::int AS committee,
              (SELECT to_char(MAX(created_at),'YYYY-MM-DD') FROM sessions s WHERE s.user_id=u.id) AS last_login
         FROM users u WHERE ${range('u.created_at')} AND ($3::text IS NULL OR $3::text IS NOT NULL) -- accounts have no event type
        ORDER BY u.created_at DESC`, args(f)),
  },
  {
    key: 'pledgers', roles: ['super', 'trust'], personal: true,
    cols: [
      { key: 'created', header: 'First pledge', width: 12 }, { key: 'name', header: 'Name', width: 22 }, { key: 'phone', header: 'Phone', width: 16, phone: true },
      { key: 'pledges', header: 'Pledges' }, { key: 'pledged', header: 'Total pledged', money: true }, { key: 'consent', header: 'Privacy notice version', width: 18 },
      { key: 'erased', header: 'Erased on request' },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(pl.created_at,'YYYY-MM-DD') AS created, pl.name, CASE WHEN pl.phone LIKE '+%' THEN pl.phone END AS phone,
              (SELECT COUNT(*) FROM pledges p WHERE p.pledger_id=pl.id)::int AS pledges,
              (SELECT COALESCE(SUM(amount),0) FROM pledges p WHERE p.pledger_id=pl.id)::bigint AS pledged,
              pl.consent_version AS consent, (pl.deleted_at IS NOT NULL) AS erased
         FROM pledgers pl WHERE ${range('pl.created_at')} AND ($3::text IS NULL OR EXISTS (
           SELECT 1 FROM pledges p JOIN events e ON e.id=p.event_id WHERE p.pledger_id=pl.id AND e.type=$3))
        ORDER BY pl.created_at DESC`, args(f)),
  },
  {
    key: 'messages', roles: ['super', 'trust'], personal: true,
    cols: [
      { key: 'created', header: 'Sent', width: 17 }, { key: 'channel', header: 'Channel' }, { key: 'purpose', header: 'Purpose', width: 18 },
      { key: 'status', header: 'Status' }, { key: 'delivery', header: 'Delivery' }, { key: 'recipient', header: 'To', width: 16, phone: true }, { key: 'event', header: 'Event', width: 30 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(m.created_at,'YYYY-MM-DD HH24:MI') AS created, m.channel, m.purpose, m.status, m.delivery_status AS delivery,
              CASE WHEN m.recipient LIKE '+%' THEN m.recipient END AS recipient, e.title AS event
         FROM messages_log m LEFT JOIN events e ON e.id=m.event_id
        WHERE ${range('m.created_at')} AND ($3::text IS NULL OR e.type = $3) ORDER BY m.created_at DESC LIMIT 20000`, args(f)),
  },
  {
    key: 'reports', roles: ['super', 'trust'], personal: false,
    cols: [
      { key: 'created', header: 'Reported', width: 17 }, { key: 'event', header: 'Event', width: 30 }, { key: 'reason', header: 'Reason', width: 40 },
      { key: 'source', header: 'Source' }, { key: 'status', header: 'Status' },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(r.created_at,'YYYY-MM-DD HH24:MI') AS created, e.title AS event, r.reason, r.source, r.status
         FROM reports r JOIN events e ON e.id=r.event_id WHERE ${range('r.created_at')} AND ${typeOk('e.type')} ORDER BY r.created_at DESC`, args(f)),
  },
  {
    key: 'audit', roles: ['super'], personal: true,
    cols: [
      { key: 'created', header: 'When', width: 19 }, { key: 'action', header: 'Action', width: 26 }, { key: 'actor', header: 'Who', width: 20 },
      { key: 'entity', header: 'On', width: 26 }, { key: 'details', header: 'Details', width: 60 },
    ],
    load: (db, f) => db.query(
      `SELECT to_char(a.created_at,'YYYY-MM-DD HH24:MI:SS') AS created, a.action, COALESCE(u.name, u.phone, 'system') AS actor,
              a.entity_type || ':' || a.entity_id AS entity, a.details::text AS details
         FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
        WHERE ${range('a.created_at')} AND ($3::text IS NULL OR $3::text IS NOT NULL) ORDER BY a.id DESC LIMIT 50000`, args(f)),
  },
];

export const ANALYTICS_ROLES: AdminRole[] = ['super', 'finance'];
export const PHONE_ROLES: AdminRole[] = ['super', 'finance'];

export function datasetsFor(role: AdminRole | null) {
  return role ? DATASETS.filter((d) => d.roles.includes(role)).map((d) => d.key) : [];
}

const clean = (v: unknown) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v;
};

/** Load the chosen datasets with phone numbers masked unless allowed and asked for. */
export async function buildExport(db: Db, keys: string[], f: ExportFilters, role: AdminRole) {
  const out: { key: string; cols: Col[]; rows: Record<string, unknown>[] }[] = [];
  const fullPhones = f.phones && PHONE_ROLES.includes(role);
  for (const key of keys) {
    const ds = DATASETS.find((d) => d.key === key);
    if (!ds || !ds.roles.includes(role)) continue;
    const raw = await ds.load(db, f);
    const rows = raw.map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of ds.cols) {
        let v = r[c.key];
        if (c.phone && typeof v === 'string' && v.startsWith('+') && !fullPhones) v = maskPhone(v);
        if (c.money && v !== null && v !== undefined && v !== '') v = Number(v);
        o[c.key] = clean(v);
      }
      return o;
    });
    out.push({ key, cols: ds.cols, rows });
  }
  return { sheets: out, fullPhones };
}

/** Spreadsheet cells never start a formula (protects whoever opens the file). */
const guard = (v: unknown) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsvSheet(sheet: { cols: Col[]; rows: Record<string, unknown>[] }) {
  const esc = (v: unknown) => `"${String(guard(v) ?? '').replace(/"/g, '""')}"`;
  return [sheet.cols.map((c) => esc(c.header)).join(','), ...sheet.rows.map((r) => sheet.cols.map((c) => esc(r[c.key])).join(','))].join('\n');
}

export async function toXlsxWorkbook(
  sheets: { key: string; cols: Col[]; rows: Record<string, unknown>[] }[],
  about: [string, string][],
  analytics?: Awaited<ReturnType<typeof platformAnalytics>>,
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ahadi';
  wb.created = new Date();
  const info = wb.addWorksheet('About this export');
  info.columns = [{ width: 26 }, { width: 70 }];
  for (const [k, v] of about) info.addRow([k, v]);
  info.getColumn(1).font = { bold: true };
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.key.charAt(0).toUpperCase() + s.key.slice(1));
    ws.columns = s.cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 14, style: c.money ? { numFmt: '#,##0' } : {} }));
    for (const r of s.rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, guard(v)])));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D5C54' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.cols.length } };
  }
  if (analytics) {
    const ws = wb.addWorksheet('Analytics summary');
    ws.columns = [{ header: 'Section', width: 14 }, { header: 'Metric', width: 34 }, { header: 'Value', width: 30 }];
    for (const line of analyticsCsv(analytics).split('\n').slice(1)) {
      ws.addRow(line.split('","').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')));
    }
    ws.getRow(1).font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
