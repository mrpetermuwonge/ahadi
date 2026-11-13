import crypto from 'node:crypto';
import type { Db } from '../db';
import { APP_SECRET } from '../config';
import { newId, randomId, sha256 } from '../ids';
import { OTP_TEMPLATE } from '../messages';
import { normalizePhone } from '../phone';
import { sendSms, fillTemplate } from '../sms';
import { codeEmailHtml, emailProviderName, sendEmail, sendWhatsAppCode, whatsappProviderName } from '../channels';
import { audit } from '../audit';
import { getSettings } from '../settings';

/**
 * Passwordless login. Three ways in:
 *   - phone number: 6-digit code via WhatsApp (falls back to SMS if WhatsApp fails, unless OTP_SMS_FALLBACK=false)
 *   - email address: 6-digit code by email
 *   - Google account (see google.ts)
 * Protections: max 3 codes per identifier per 10 minutes, codes expire after 5 minutes and allow 5 wrong
 * guesses, and 10 failures in a row lock the identifier for 30 minutes.
 */
export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export type IdKind = 'phone' | 'email';
export type CodePurpose = 'login' | 'add_phone' | 'pledger';
export type Channel = 'whatsapp' | 'sms' | 'email';

const hashCode = (identifier: string, code: string) => sha256(`${APP_SECRET()}:${identifier}:${code}`);
export const SESSION_DAYS = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function normalizeEmail(raw: string): string | null {
  const e = (raw || '').trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export function parseIdentifier(kind: IdKind, raw: string): string {
  const v = kind === 'phone' ? normalizePhone(raw) : normalizeEmail(raw);
  if (!v) throw new AuthError(kind === 'phone' ? 'invalid_phone' : 'invalid_email');
  return v;
}

const list = (env: string | undefined, norm: (s: string) => string | null) =>
  (env || '').split(',').map((p) => norm(p.trim())).filter(Boolean) as string[];
export const isAdminIdentity = (phone: string | null, email: string | null) =>
  (!!phone && list(process.env.ADMIN_PHONES, normalizePhone).includes(phone)) ||
  (!!email && list(process.env.ADMIN_EMAILS, normalizeEmail).includes(email));

async function assertNotLocked(db: Db, identifier: string) {
  const [lock] = await db.query('SELECT locked_until FROM login_lockouts WHERE identifier=$1', [identifier]);
  if (lock?.locked_until && new Date(lock.locked_until) > new Date()) throw new AuthError('locked');
}

/** Development helper: show the code on screen only when nothing real is sending it. */
/**
 * TEMPORARY TEST MODE (OTP_SHOW_ON_SCREEN=true): codes are shown on screen because WhatsApp/SMS are not
 * connected yet. While on, anyone can confirm any phone number, so it must be switched off before real users.
 */
export const codesOnScreen = () => process.env.OTP_SHOW_ON_SCREEN === 'true';

function devVisible(channel: Channel): boolean {
  if (codesOnScreen()) return true;
  if (process.env.NODE_ENV === 'production') return false;
  if (channel === 'whatsapp') return whatsappProviderName() === 'console';
  if (channel === 'email') return emailProviderName() === 'console';
  return (process.env.SMS_PROVIDER ?? 'console') === 'console';
}

/**
 * How often a number may receive codes. Every pledge and every portal visit needs a code, so the limits are
 * generous, but they still stop someone flooding another person's WhatsApp (and running up message costs).
 * All three are admin settings. In test mode (codes shown on screen, nothing is sent) there is no limit.
 */
async function assertCodeAllowance(db: Db, identifier: string) {
  if (codesOnScreen()) return;
  const s = await getSettings(db);
  const [r] = await db.query<{ last10: number; last24h: number; gap: number | null }>(
    `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS last10,
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h,
            EXTRACT(EPOCH FROM (now() - MAX(created_at)))::int AS gap
       FROM otp_codes WHERE identifier=$1`,
    [identifier],
  );
  if (r.gap !== null && r.gap < s.otp_min_gap_seconds) throw new AuthError('code_wait');
  if (r.last10 >= s.otp_max_per_10min || r.last24h >= s.otp_max_per_day) throw new AuthError('too_many_codes');
}

/** Create and send a code. Returns the normalised identifier and the channel actually used. */
export async function requestCode(
  db: Db,
  a: { kind: IdKind; value: string; locale?: string; purpose?: CodePurpose },
): Promise<{ identifier: string; channel: Channel; devCode?: string }> {
  const identifier = parseIdentifier(a.kind, a.value);
  const purpose = a.purpose ?? 'login';
  const locale = a.locale ?? 'en';
  await assertNotLocked(db, identifier);
  await assertCodeAllowance(db, identifier);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

  let channel: Channel;
  if (a.kind === 'email') {
    channel = 'email';
    const subject = fillTemplate(EMAIL_SUBJECT[locale] ?? EMAIL_SUBJECT.en, { code });
    const text = fillTemplate(OTP_TEMPLATE[locale] ?? OTP_TEMPLATE.en, { code });
    const r = await sendEmail(db, identifier, subject, text, codeEmailHtml(EMAIL_HEADING[locale] ?? EMAIL_HEADING.en, code, EMAIL_NOTE[locale] ?? EMAIL_NOTE.en), `otp_${purpose}`);
    if (!r.ok) throw new AuthError('send_failed');
  } else {
    channel = 'whatsapp';
    const r = await sendWhatsAppCode(db, identifier, code, locale, `otp_${purpose}`);
    if (!r.ok) {
      // WhatsApp can fail (number not on WhatsApp, template not approved, outage). SMS keeps login working.
      if (process.env.OTP_SMS_FALLBACK === 'false') throw new AuthError('send_failed');
      channel = 'sms';
      const s = await sendSms(db, identifier, fillTemplate(OTP_TEMPLATE[locale] ?? OTP_TEMPLATE.en, { code }), 'otp');
      if (!s.ok) throw new AuthError('send_failed');
    }
  }
  await db.query(
    `INSERT INTO otp_codes(id, identifier, code_hash, channel, purpose, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '5 minutes')`,
    [newId('otp'), identifier, hashCode(identifier, code), channel, purpose],
  );
  return { identifier, channel, devCode: devVisible(channel) ? code : undefined };
}

/** Check a code (any purpose). Throws on failure and counts towards the lockout. */
export async function consumeCode(db: Db, identifier: string, code: string, purpose: CodePurpose) {
  if (!/^\d{6}$/.test(code)) throw new AuthError('invalid_code');
  await assertNotLocked(db, identifier);
  const [otp] = await db.query(
    `SELECT * FROM otp_codes WHERE identifier=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
    [identifier, purpose],
  );
  const ok = otp && otp.attempts < 5 && otp.code_hash === hashCode(identifier, code);
  if (!ok) {
    if (otp) await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1', [otp.id]);
    await db.query(
      `INSERT INTO login_lockouts(identifier, failures) VALUES ($1, 1)
       ON CONFLICT (identifier) DO UPDATE SET failures = login_lockouts.failures + 1,
         locked_until = CASE WHEN login_lockouts.failures + 1 >= 10 THEN now() + interval '30 minutes' ELSE login_lockouts.locked_until END`,
      [identifier],
    );
    throw new AuthError(otp ? 'wrong_code' : 'expired_code');
  }
  await db.query('UPDATE otp_codes SET used_at=now() WHERE id=$1', [otp.id]);
  await db.query('DELETE FROM login_lockouts WHERE identifier=$1', [identifier]);
}

/** The login phone is proven by the code, so it becomes a verified mobile money payout destination. */
async function ensurePhonePayoutAccount(db: Db, userId: string, phone: string) {
  const acct = await db.query(`SELECT 1 FROM payout_accounts WHERE user_id=$1 AND kind='mobile_money' AND phone=$2`, [userId, phone]);
  if (acct.length === 0) {
    await db.query(
      `INSERT INTO payout_accounts(id, user_id, kind, label, phone, verified) VALUES ($1,$2,'mobile_money','My mobile money',$3,true)`,
      [newId('pa'), userId, phone],
    );
  }
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomId(40);
  await db.query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
  return token;
}

async function promoteIfAdmin(db: Db, user: any) {
  if (!user.is_admin && isAdminIdentity(user.phone, user.email)) {
    await db.query('UPDATE users SET is_admin=true WHERE id=$1', [user.id]);
  }
}

/** Log in (or sign up) with a phone or email code. */
export async function verifyLoginCode(db: Db, a: { kind: IdKind; value: string; code: string }): Promise<{ userId: string; token: string }> {
  const identifier = parseIdentifier(a.kind, a.value);
  await consumeCode(db, identifier, a.code, 'login');
  return signInUser(db, a.kind, identifier);
}

/** Organizer sign-in (or sign-up) for an identifier already proven by a code. */
export async function signInUser(db: Db, kind: IdKind, identifier: string): Promise<{ userId: string; token: string }> {
  const a = { kind };
  const col = a.kind === 'phone' ? 'phone' : 'email';
  let [user] = await db.query(`SELECT * FROM users WHERE ${col}=$1`, [identifier]);
  if (!user) {
    [user] = await db.query(
      `INSERT INTO users(id, ${col}, is_admin, email_verified_at) VALUES ($1,$2,$3,$4) RETURNING *`,
      [newId('usr'), identifier, false, a.kind === 'email' ? new Date().toISOString() : null],
    );
    await audit(db, { actor: user.id, action: 'user.signup', entityType: 'user', entityId: user.id, details: { via: a.kind } });
  } else if (a.kind === 'email' && !user.email_verified_at) {
    await db.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [user.id]);
  }
  await promoteIfAdmin(db, user);
  if (a.kind === 'phone') await ensurePhonePayoutAccount(db, user.id, identifier);
  return { userId: user.id, token: await createSession(db, user.id) };
}

/**
 * Google sign-in. Matching order: the Google account id, then a verified email already on an Ahadi account
 * (so "email code" and "Google" with the same Gmail address are the same account), else a new account.
 */
export async function loginWithGoogleProfile(
  db: Db,
  p: { sub: string; email: string | null; emailVerified: boolean; name: string | null },
): Promise<{ userId: string; token: string }> {
  const email = p.email && p.emailVerified ? normalizeEmail(p.email) : null;
  let [user] = await db.query('SELECT * FROM users WHERE google_sub=$1', [p.sub]);
  if (!user && email) {
    [user] = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    if (user) await db.query('UPDATE users SET google_sub=$2, email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1', [user.id, p.sub]);
  }
  if (!user) {
    if (!email) throw new AuthError('google_no_email');
    [user] = await db.query(
      `INSERT INTO users(id, email, google_sub, name, email_verified_at) VALUES ($1,$2,$3,$4, now()) RETURNING *`,
      [newId('usr'), email, p.sub, p.name?.slice(0, 80) ?? null],
    );
    await audit(db, { actor: user.id, action: 'user.signup', entityType: 'user', entityId: user.id, details: { via: 'google' } });
  } else if (!user.name && p.name) {
    await db.query('UPDATE users SET name=$2 WHERE id=$1', [user.id, p.name.slice(0, 80)]);
  }
  await promoteIfAdmin(db, user);
  return { userId: user.id, token: await createSession(db, user.id) };
}

/**
 * Add a verified phone number to a signed-in account (needed by email/Google users to withdraw to mobile money
 * and to receive milestone messages). If the number belongs to a committee invite that never logged in,
 * that invite's roles are merged into this account.
 */
export async function addPhoneToUser(db: Db, userId: string, rawPhone: string, code: string) {
  const phone = parseIdentifier('phone', rawPhone);
  await consumeCode(db, phone, code, 'add_phone');
  await db.tx(async (q) => {
    const [other] = await q.query('SELECT * FROM users WHERE phone=$1 AND id<>$2', [phone, userId]);
    if (other) {
      const [{ n }] = await q.query<{ n: number }>(
        `SELECT (SELECT COUNT(*) FROM sessions WHERE user_id=$1) + (SELECT COUNT(*) FROM events WHERE created_by=$1)::int AS n`,
        [other.id],
      );
      if (Number(n) > 0 || other.email || other.google_sub) throw new AuthError('phone_in_use');
      // Placeholder created by a committee invite: move its roles here, then remove it.
      await q.query(`DELETE FROM event_members WHERE user_id=$1 AND event_id IN (SELECT event_id FROM event_members WHERE user_id=$2)`, [other.id, userId]);
      await q.query('UPDATE event_members SET user_id=$2 WHERE user_id=$1', [other.id, userId]);
      await q.query('UPDATE event_members SET added_by=$2 WHERE added_by=$1', [other.id, userId]);
      await q.query('DELETE FROM users WHERE id=$1', [other.id]);
    }
    await q.query('UPDATE users SET phone=$2 WHERE id=$1', [userId, phone]);
    await ensurePhonePayoutAccount(q, userId, phone);
    await audit(q, { actor: userId, action: 'user.phone_added', entityType: 'user', entityId: userId, details: { merged: !!other } });
  });
}

const EMAIL_SUBJECT: Record<string, string> = { en: 'Your Ahadi code: {code}', lg: 'Koodi yo eya Ahadi: {code}', sw: 'Nambari yako ya Ahadi: {code}' };
const EMAIL_HEADING: Record<string, string> = { en: 'Your login code', lg: 'Koodi yo ey\'okuyingira', sw: 'Nambari yako ya kuingia' };
const EMAIL_NOTE: Record<string, string> = {
  en: 'It expires in 5 minutes. If you did not ask for it, you can ignore this email.',
  lg: 'Eggwaako mu ddakiika 5. Bw\'oba tewagisabye, buuka email eno.',
  sw: 'Inaisha baada ya dakika 5. Kama hukuiomba, puuza barua pepe hii.',
};

export async function userFromToken(db: Db, token: string | undefined | null) {
  if (!token) return null;
  const [u] = await db.query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return u ?? null;
}

export async function logout(db: Db, token: string) {
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(token)]);
}

/** How to show a user in the interface: name, else phone, else email. */
export const displayIdentity = (u: { name?: string | null; phone?: string | null; email?: string | null }) =>
  u.name || u.phone || u.email || '';

export type Role = 'owner' | 'treasurer' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, treasurer: 2, owner: 3 };

/** Server-side role check. Admins can read everything; writes need a real role. */
export async function roleFor(db: Db, eventId: string, user: { id: string; is_admin: boolean }): Promise<Role | 'admin' | null> {
  const [m] = await db.query<{ role: Role }>('SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2', [eventId, user.id]);
  if (m) return m.role;
  return user.is_admin ? 'admin' : null;
}

export function hasRole(role: Role | 'admin' | null, needed: Role): boolean {
  if (!role) return false;
  if (role === 'admin') return needed === 'viewer';
  return RANK[role] >= RANK[needed];
}
