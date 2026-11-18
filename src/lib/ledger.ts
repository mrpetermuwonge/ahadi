import type { Db } from './db';
import { newId } from './ids';

/**
 * DOUBLE-ENTRY LEDGER — the single source of truth for every money figure.
 *
 * Sign convention: debit = positive, credit = negative. Every journal's lines sum to exactly zero.
 * Rows are append-only (enforced by a database trigger). A mistake is fixed by a reversing journal.
 *
 * Accounts
 *   receivable          per pledge: what the pledger still owes (negative = overpaid)
 *   pledge_income       per pledge: total promised (credit balance)
 *   organizer_cash      event: money at the payment provider that belongs to the organizer
 *   offline_cash        event: cash / offline money recorded by a treasurer (not withdrawable)
 *   ahadi_cash          money at the provider that belongs to Ahadi (fees, tips, passes, credits)
 *   fee_expense         event: Ahadi fee absorbed by the organizer (when pledger did not cover it)
 *   ahadi_fee_revenue / ahadi_tip_revenue / ahadi_pass_revenue / ahadi_credit_revenue
 *   payout_pending      event: money held for a payout in progress
 *   paid_out            event: money sent to the organizer
 */
export type Account =
  | 'receivable'
  | 'pledge_income'
  | 'organizer_cash'
  | 'offline_cash'
  | 'ahadi_cash'
  | 'fee_expense'
  | 'ahadi_fee_revenue'
  | 'ahadi_tip_revenue'
  | 'ahadi_pass_revenue'
  | 'ahadi_credit_revenue'
  | 'payout_pending'
  | 'paid_out';

export interface Line {
  account: Account;
  amount: number; // debit +, credit -
  pledgeId?: string | null;
}

export interface PostInput {
  eventId: string | null;
  kind: string;
  sourceType: string;
  sourceId: string;
  currency: string;
  lines: Line[];
  memo?: string;
  receiptNo?: string | null;
  createdBy?: string | null;
  reversesId?: string | null;
}

export class LedgerError extends Error {}

/**
 * Post a balanced journal. Idempotent: the same (kind, sourceType, sourceId) is only ever posted once;
 * a second call returns the existing journal id and changes nothing.
 * Must be called inside a transaction together with the business change it records.
 */
export async function post(q: Db, input: PostInput): Promise<{ journalId: string; created: boolean }> {
  const lines = input.lines.filter((l) => l.amount !== 0);
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amount)) throw new LedgerError(`non-integer amount on ${l.account}`);
  }
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (sum !== 0) throw new LedgerError(`journal ${input.kind}/${input.sourceId} does not balance (${sum})`);
  if (lines.length === 0) throw new LedgerError('empty journal');

  const id = newId('jn');
  const inserted = await q.query<{ id: string }>(
    `INSERT INTO ledger_journals(id, event_id, kind, source_type, source_id, reverses_id, memo, receipt_no, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (kind, source_type, source_id) DO NOTHING RETURNING id`,
    [id, input.eventId, input.kind, input.sourceType, input.sourceId, input.reversesId ?? null, input.memo ?? null, input.receiptNo ?? null, input.createdBy ?? null],
  );
  if (inserted.length === 0) {
    const [existing] = await q.query<{ id: string }>(
      'SELECT id FROM ledger_journals WHERE kind=$1 AND source_type=$2 AND source_id=$3',
      [input.kind, input.sourceType, input.sourceId],
    );
    return { journalId: existing.id, created: false };
  }
  for (const l of lines) {
    await q.query(
      `INSERT INTO ledger_entries(journal_id, event_id, pledge_id, account, amount, currency) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, input.eventId, l.pledgeId ?? null, l.account, l.amount, input.currency],
    );
  }
  return { journalId: id, created: true };
}

/** Post the exact opposite of a journal. A journal can be reversed once; reversals cannot be reversed. */
export async function reverse(q: Db, journalId: string, actor: string | null, memo: string) {
  const [j] = await q.query('SELECT * FROM ledger_journals WHERE id=$1', [journalId]);
  if (!j) throw new LedgerError('journal not found');
  if (j.kind === 'reversal') throw new LedgerError('a reversal cannot itself be reversed');
  const entries = await q.query('SELECT account, amount, pledge_id, currency FROM ledger_entries WHERE journal_id=$1', [journalId]);
  return post(q, {
    eventId: j.event_id,
    kind: 'reversal',
    sourceType: 'journal',
    sourceId: journalId,
    reversesId: journalId,
    currency: entries[0].currency,
    memo,
    createdBy: actor,
    lines: entries.map((e) => ({ account: e.account, amount: -Number(e.amount), pledgeId: e.pledge_id })),
  });
}

// ---------- Journal builders (pure functions, unit tested) ----------

export function pledgeLines(pledgeId: string, amount: number): Line[] {
  return [
    { account: 'receivable', amount, pledgeId },
    { account: 'pledge_income', amount: -amount, pledgeId },
  ];
}

/** delta > 0 increases the pledge, delta < 0 reduces it. */
export const pledgeChangeLines = pledgeLines;

export interface PaymentSplit {
  pledgeCredit: number; // P: credited to the pledge
  fee: number; // F: Ahadi fee
  feeCovered: boolean; // pledger paid F on top
  tip: number; // T: optional tip to Ahadi
}

export function chargedAmount(s: PaymentSplit): number {
  return s.pledgeCredit + s.tip + (s.feeCovered ? s.fee : 0);
}

export function paymentLines(pledgeId: string, s: PaymentSplit): Line[] {
  const organizerNet = s.pledgeCredit - (s.feeCovered ? 0 : s.fee);
  if (organizerNet < 0) throw new LedgerError('fee larger than payment');
  return [
    { account: 'organizer_cash', amount: organizerNet },
    { account: 'ahadi_cash', amount: s.fee + s.tip },
    { account: 'fee_expense', amount: s.feeCovered ? 0 : s.fee },
    { account: 'receivable', amount: -s.pledgeCredit, pledgeId },
    { account: 'ahadi_fee_revenue', amount: -s.fee },
    { account: 'ahadi_tip_revenue', amount: -s.tip },
  ];
}

export function manualPaymentLines(pledgeId: string, amount: number): Line[] {
  return [
    { account: 'offline_cash', amount },
    { account: 'receivable', amount: -amount, pledgeId },
  ];
}

// ---------- Read models (the dashboard, exports and admin all use these) ----------

export interface EventTotals {
  pledged: number;
  collected: number;
  outstanding: number; // sum of positive receivables (what is still owed)
  overpaid: number; // sum of negative receivables
  collectedOnline: number;
  collectedOffline: number;
  available: number; // organizer_cash balance: withdrawable now
  payoutPending: number;
  paidOut: number;
  feesAbsorbed: number;
  pledgeCount: number;
}

export async function eventTotals(q: Db, eventId: string): Promise<EventTotals> {
  const acc = await q.query<{ account: string; bal: number }>(
    `SELECT account, COALESCE(SUM(amount),0)::bigint AS bal FROM ledger_entries WHERE event_id=$1 GROUP BY account`,
    [eventId],
  );
  const b = (a: Account) => Number(acc.find((r) => r.account === a)?.bal ?? 0);
  const per = await q.query<{ owed: number; overpaid: number; n: number }>(
    `SELECT COALESCE(SUM(GREATEST(bal,0)),0)::bigint AS owed, COALESCE(SUM(LEAST(bal,0)),0)::bigint AS overpaid, COUNT(*)::int AS n
       FROM (SELECT pledge_id, SUM(amount) AS bal FROM ledger_entries
              WHERE event_id=$1 AND account='receivable' GROUP BY pledge_id) x`,
    [eventId],
  );
  const pledged = -b('pledge_income') + 0; // + 0 turns -0 into 0
  const collectedOffline = b('offline_cash');
  const collected = pledged - b('receivable') + 0;
  return {
    pledged,
    collected,
    outstanding: Number(per[0].owed),
    overpaid: -Number(per[0].overpaid),
    collectedOffline,
    collectedOnline: collected - collectedOffline,
    available: b('organizer_cash'),
    payoutPending: b('payout_pending'),
    paidOut: b('paid_out'),
    feesAbsorbed: b('fee_expense'),
    pledgeCount: Number(per[0].n),
  };
}

export interface PledgeBalance {
  pledgeId: string;
  pledged: number;
  paid: number;
  balance: number; // > 0 owed, < 0 overpaid
}

export async function pledgeBalances(q: Db, eventId: string): Promise<Map<string, PledgeBalance>> {
  const rows = await q.query<{ pledge_id: string; pledged: number; recv: number }>(
    `SELECT pledge_id,
            (-COALESCE(SUM(amount) FILTER (WHERE account='pledge_income'),0))::bigint AS pledged,
            COALESCE(SUM(amount) FILTER (WHERE account='receivable'),0)::bigint AS recv
       FROM ledger_entries WHERE event_id=$1 AND pledge_id IS NOT NULL GROUP BY pledge_id`,
    [eventId],
  );
  const m = new Map<string, PledgeBalance>();
  for (const r of rows) {
    const pledged = Number(r.pledged);
    const recv = Number(r.recv);
    m.set(r.pledge_id, { pledgeId: r.pledge_id, pledged, paid: pledged - recv, balance: recv });
  }
  return m;
}

export async function pledgeBalance(q: Db, pledgeId: string): Promise<PledgeBalance> {
  const [r] = await q.query<{ pledged: number; recv: number }>(
    `SELECT (-COALESCE(SUM(amount) FILTER (WHERE account='pledge_income'),0))::bigint AS pledged,
            COALESCE(SUM(amount) FILTER (WHERE account='receivable'),0)::bigint AS recv
       FROM ledger_entries WHERE pledge_id=$1`,
    [pledgeId],
  );
  const pledged = Number(r?.pledged ?? 0);
  const recv = Number(r?.recv ?? 0);
  return { pledgeId, pledged, paid: pledged - recv, balance: recv };
}

/** Whole-ledger check used by tests and reconciliation: every journal balances. */
export async function unbalancedJournals(q: Db): Promise<string[]> {
  const rows = await q.query<{ journal_id: string }>(
    `SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING SUM(amount) <> 0`,
  );
  return rows.map((r) => r.journal_id);
}

export type PledgeState = 'paid' | 'partial' | 'unpaid' | 'overdue';
export function pledgeState(b: PledgeBalance, dueDate: string | null, today: string): PledgeState {
  if (b.balance <= 0) return 'paid';
  if (dueDate && dueDate < today) return 'overdue';
  return b.paid > 0 ? 'partial' : 'unpaid';
}
