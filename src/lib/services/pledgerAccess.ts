import type { Db } from '../db';
import { randomId, sha256 } from '../ids';
import { pledgeBalance, pledgeState, type PledgeState } from '../ledger';
import { localDate } from '../time';
import { normalizePhone } from '../phone';
import { AuthError, consumeCode, requestCode } from './auth';

/**
 * Pledger identity without accounts: a fresh one-time code every time the pledger enters their portal.
 *
 *   - The pledger types their number and receives a 6-digit code (WhatsApp, SMS fallback; shown on screen
 *     while OTP_SHOW_ON_SCREEN is on). Nothing is permanent: no PIN, no password, no remembered device.
 *   - The code opens a verification for that exact number on this browser (at most 15 minutes). During it they
 *     can see their pledges and make ONE pledge. Leaving the portal (going back to an event page or the
 *     homepage, or reopening the form or My pledges) ends it, so coming back always needs a new code.
 *   - Wrong codes: each code allows 5 tries and 10 failures in a row lock the number for 30 minutes
 *     (the same protections as organizer login).
 */
export const DEVICE_COOKIE = 'ahadi_pledger';
export const VERIFY_MINUTES = 15;

function phoneOrThrow(raw: string): string {
  const p = normalizePhone(raw);
  if (!p) throw new AuthError('invalid_phone');
  return p;
}

/** Phone verified on this browser in the last 15 minutes, or null. */
export async function devicePhone(db: Db, token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [r] = await db.query(
    `SELECT phone FROM pledger_devices WHERE token_hash=$1 AND expires_at > now() AND verified_at IS NOT NULL`,
    [sha256(token)],
  );
  return r?.phone ?? null;
}

export async function forgetDevice(db: Db, token: string) {
  await db.query('DELETE FROM pledger_devices WHERE token_hash=$1', [sha256(token)]);
}

/** Send the one-time code. Same rate limits as login (3 codes per 10 minutes per number). */
export function sendPledgerCode(db: Db, rawPhone: string, locale?: string) {
  return requestCode(db, { kind: 'phone', value: rawPhone, locale, purpose: 'pledger' });
}

/** Check the code and open a 15-minute verification for this number. Replaces any earlier one on this browser. */
export async function verifyPledger(db: Db, a: { phone: string; code: string }, currentToken?: string | null): Promise<{ phone: string; token: string }> {
  const phone = phoneOrThrow(a.phone);
  await consumeCode(db, phone, a.code, 'pledger');
  return { phone, token: await openPledgerSession(db, phone, currentToken) };
}

/**
 * Open the pledger portal for a number that has JUST been proven with a code (pledge form, personal link,
 * or the shared login page). Replaces any earlier verification on this browser.
 */
export async function openPledgerSession(db: Db, phone: string, currentToken?: string | null): Promise<string> {
  if (currentToken) await forgetDevice(db, currentToken);
  const token = randomId(40);
  await db.query(
    `INSERT INTO pledger_devices(token_hash, phone, verified_at, expires_at) VALUES ($1,$2, now(), now() + interval '${VERIFY_MINUTES} minutes')`,
    [sha256(token), phone],
  );
  return token;
}

/**
 * Gate for every new pledge: this browser must hold a live, unused verification for this very number.
 * Returns `useUp`, called once the pledge exists: the verification can still VIEW the portal (receipt,
 * pledge page) until the pledger leaves it, but it cannot make a second pledge.
 */
export async function requireVerifiedForPledge(db: Db, token: string | undefined | null, rawPhone: string) {
  const phone = phoneOrThrow(rawPhone);
  if (!token) throw new AuthError('verify_required');
  const [r] = await db.query(
    `SELECT phone FROM pledger_devices WHERE token_hash=$1 AND expires_at > now() AND verified_at IS NOT NULL AND used_at IS NULL`,
    [sha256(token)],
  );
  if (r?.phone !== phone) throw new AuthError('verify_required');
  return async () => {
    await db.query('UPDATE pledger_devices SET used_at=now() WHERE token_hash=$1', [sha256(token)]);
  };
}

/** The phone a personal pledge link belongs to (null if the link is unknown). */
export async function pledgePhone(db: Db, pledgeToken: string): Promise<string | null> {
  const [r] = await db.query(
    `SELECT pl.phone FROM pledges pg JOIN pledgers pl ON pl.id=pg.pledger_id WHERE pg.access_token=$1 AND pl.deleted_at IS NULL`,
    [pledgeToken],
  );
  return r?.phone ?? null;
}

/** May this browser open this personal pledge page? Only with a live verification for the pledge's own number. */
export async function canViewPledge(db: Db, deviceToken: string | undefined | null, pledgeToken: string): Promise<boolean> {
  const [owner, verified] = await Promise.all([pledgePhone(db, pledgeToken), devicePhone(db, deviceToken)]);
  return !!owner && owner === verified;
}

/** Personal link opened without a verification: send the code to the pledge's own number (never shown in full). */
export async function sendCodeForPledge(db: Db, pledgeToken: string, locale?: string) {
  const phone = await pledgePhone(db, pledgeToken);
  if (!phone) throw new AuthError('not_found');
  return requestCode(db, { kind: 'phone', value: phone, locale, purpose: 'pledger' });
}

export async function verifyForPledge(db: Db, pledgeToken: string, code: string, currentToken?: string | null) {
  const phone = await pledgePhone(db, pledgeToken);
  if (!phone) throw new AuthError('not_found');
  return verifyPledger(db, { phone, code }, currentToken);
}

export interface PledgeSummaryItem {
  token: string;
  eventTitle: string;
  eventSlug: string;
  eventType: string;
  coverFileId: string | null; // organizer's cover photo (public), for the slide view
  open: boolean;
  currency: string;
  pledged: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  createdAt: string;
  state: PledgeState;          // paid | partial | unpaid | overdue
  lastPaidAt: string | null;   // date of the most recent successful payment
}

/** Everything a verified pledger has promised, with live paid / still-to-pay figures from the ledger. */
export async function pledgerSummary(db: Db, phone: string) {
  const [p] = await db.query('SELECT id, name FROM pledgers WHERE phone=$1 AND deleted_at IS NULL', [phone]);
  if (!p) return { name: null as string | null, items: [] as PledgeSummaryItem[], totals: [] as { currency: string; pledged: number; paid: number; balance: number }[], next: null as PledgeSummaryItem | null };
  const rows = await db.query(
    `SELECT pg.id, pg.access_token, pg.currency, pg.due_date, pg.created_at, e.title, e.slug, e.type, e.status, e.frozen, e.cover_file_id
       FROM pledges pg JOIN events e ON e.id=pg.event_id WHERE pg.pledger_id=$1 AND pg.disputed_at IS NULL ORDER BY pg.created_at DESC LIMIT 50`,
    [p.id],
  );
  const items: PledgeSummaryItem[] = [];
  const today = localDate();
  for (const r of rows) {
    const b = await pledgeBalance(db, r.id);
    const [last] = await db.query(`SELECT max(succeeded_at) AS at FROM payments WHERE pledge_id=$1 AND status='succeeded'`, [r.id]);
    items.push({
      token: r.access_token, eventTitle: r.title, eventSlug: r.slug, eventType: r.type, coverFileId: r.cover_file_id ?? null, open: r.status === 'active' && !r.frozen,
      currency: r.currency, pledged: b.pledged, paid: b.paid, balance: b.balance, dueDate: r.due_date,
      createdAt: new Date(r.created_at).toISOString().slice(0, 10),
      state: pledgeState(b, r.due_date, today),
      lastPaidAt: last?.at ? new Date(last.at).toISOString().slice(0, 10) : null,
    });
  }
  // Totals per currency (an East African pledger may hold UGX and KES pledges).
  const byCur = new Map<string, { currency: string; pledged: number; paid: number; balance: number }>();
  for (const i of items) {
    const t = byCur.get(i.currency) ?? { currency: i.currency, pledged: 0, paid: 0, balance: 0 };
    t.pledged += i.pledged;
    t.paid += i.paid;
    t.balance += Math.max(0, i.balance);
    byCur.set(i.currency, t);
  }
  // The soonest unpaid due date, so the pledger knows what to pay next.
  const next = items.filter((i) => i.balance > 0 && i.dueDate).sort((x, y) => (x.dueDate! < y.dueDate! ? -1 : 1))[0] ?? null;
  return { name: p.name as string, items, totals: [...byCur.values()], next };
}
