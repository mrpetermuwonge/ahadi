import type { Db } from '../db';
import { APP_URL } from '../config';
import { audit } from '../audit';
import { newId, randomId } from '../ids';
import { notify } from '../notify';
import { normalizePhone } from '../phone';
import { sendEmail } from '../channels';
import { EventError } from './events';

/**
 * Help and contact: anyone (pledger, organizer, visitor) can write to Ahadi support. They get a reference
 * number and a private link to follow the conversation; staff answer from Admin → Support and the person is
 * told by WhatsApp (or email). Limited to 5 requests per phone/email per day to stop spam.
 */
export const TOPICS = ['payment', 'pledge', 'event', 'account', 'fraud', 'other'] as const;
export type Topic = (typeof TOPICS)[number];

const ref = () => `AH-SUP-${randomId(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 4)}`;

export async function createRequest(db: Db, input: { name: string; contact: string; topic: string; message: string; eventRef?: string | null; userId?: string | null }) {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) throw new EventError('invalid_name');
  if (!(TOPICS as readonly string[]).includes(input.topic)) throw new EventError('invalid_input');
  const message = input.message.trim();
  if (message.length < 10 || message.length > 2000) throw new EventError('invalid_message');
  const c = input.contact.trim();
  const phone = /@/.test(c) ? null : normalizePhone(c);
  const email = /@/.test(c) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c.toLowerCase() : null;
  if (!phone && !email) throw new EventError('invalid_contact');
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM support_requests WHERE (phone=$1 OR email=$2) AND created_at > now() - interval '1 day'`, [phone, email]);
  if (n >= 5) throw new EventError('too_many_requests');
  const id = newId('sup');
  const token = randomId(24);
  let r = ref();
  for (let i = 0; i < 3; i++) {
    const [clash] = await db.query(`SELECT 1 FROM support_requests WHERE ref=$1`, [r]);
    if (!clash) break;
    r = ref();
  }
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO support_requests(id, ref, token, name, phone, email, topic, event_ref, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, r, token, name, phone, email, input.topic, (input.eventRef ?? '').trim().slice(0, 200) || null, input.userId ?? null],
    );
    await q.query(`INSERT INTO support_messages(id, request_id, from_staff, body) VALUES ($1,$2,false,$3)`, [newId('sm'), id, message]);
    await audit(q, { actor: input.userId ?? null, action: 'support.created', entityType: 'support_request', entityId: id, details: { topic: input.topic } });
  });
  return { ref: r, token };
}

export async function requestByToken(db: Db, token: string) {
  const [r] = await db.query(`SELECT id, ref, name, topic, status, created_at FROM support_requests WHERE token=$1`, [token]);
  if (!r) return null;
  const messages = await db.query(`SELECT from_staff, body, created_at FROM support_messages WHERE request_id=$1 ORDER BY created_at`, [r.id]);
  return { ...r, messages };
}

/** The person adds to their own request (from their private link). Re-opens a resolved request. */
export async function addRequesterMessage(db: Db, token: string, body: string) {
  const text = body.trim();
  if (text.length < 2 || text.length > 2000) throw new EventError('invalid_message');
  const [r] = await db.query(`SELECT id FROM support_requests WHERE token=$1`, [token]);
  if (!r) throw new EventError('not_found');
  const [{ n }] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM support_messages WHERE request_id=$1 AND NOT from_staff AND created_at > now() - interval '1 hour'`, [r.id]);
  if (n >= 10) throw new EventError('too_many_requests');
  await db.query(`INSERT INTO support_messages(id, request_id, from_staff, body) VALUES ($1,$2,false,$3)`, [newId('sm'), r.id, text]);
  await db.query(`UPDATE support_requests SET status='open', updated_at=now() WHERE id=$1`, [r.id]);
}

export async function listRequests(db: Db, status: 'open' | 'waiting' | 'resolved' | 'all', mine: string | null) {
  return db.query(
    `SELECT r.id, r.ref, r.name, r.phone, r.email, r.topic, r.status, r.created_at, r.updated_at, a.name AS assignee,
            (SELECT body FROM support_messages m WHERE m.request_id=r.id ORDER BY created_at DESC LIMIT 1) AS last
       FROM support_requests r LEFT JOIN users a ON a.id=r.assigned_to
      WHERE ($1 = 'all' OR r.status=$1) AND ($2::text IS NULL OR r.assigned_to=$2)
      ORDER BY CASE r.topic WHEN 'fraud' THEN 0 WHEN 'payment' THEN 1 ELSE 2 END, r.updated_at DESC LIMIT 200`,
    [status, mine],
  );
}

export async function requestDetail(db: Db, id: string) {
  const [r] = await db.query(`SELECT r.*, a.name AS assignee FROM support_requests r LEFT JOIN users a ON a.id=r.assigned_to WHERE r.id=$1`, [id]);
  if (!r) return null;
  const messages = await db.query(
    `SELECT m.from_staff, m.body, m.created_at, u.name AS author FROM support_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.request_id=$1 ORDER BY m.created_at`, [id]);
  return { request: r, messages };
}

/** Staff answer: saved on the request and the person is told by WhatsApp (or email) with their private link. */
export async function staffReply(db: Db, id: string, staffId: string, body: string, resolve: boolean) {
  const text = body.trim();
  if (text.length < 2 || text.length > 2000) throw new EventError('invalid_message');
  const [r] = await db.query(`SELECT * FROM support_requests WHERE id=$1`, [id]);
  if (!r) throw new EventError('not_found');
  await db.query(`INSERT INTO support_messages(id, request_id, from_staff, author_id, body) VALUES ($1,$2,true,$3,$4)`, [newId('sm'), id, staffId, text]);
  await db.query(`UPDATE support_requests SET status=$2, assigned_to=COALESCE(assigned_to,$3), updated_at=now() WHERE id=$1`, [id, resolve ? 'resolved' : 'waiting', staffId]);
  await audit(db, { actor: staffId, action: 'support.replied', entityType: 'support_request', entityId: id, details: { resolve } });
  const link = `${APP_URL()}/help/r/${r.token}`;
  if (r.phone) {
    await notify(db, { to: r.phone, stage: 'support_reply', eventType: 'other', locale: 'en', purpose: 'support_reply', vars: { ref: r.ref, link } }).catch(() => {});
  } else if (r.email) {
    const msg = `Ahadi support replied to your request ${r.ref}. Read and answer here: ${link}`;
    await sendEmail(db, r.email, `Ahadi support: ${r.ref}`, msg, `<p>${msg}</p>`, 'support_reply').catch(() => {});
  }
}

export async function setRequestStatus(db: Db, id: string, staffId: string, change: { status?: 'open' | 'waiting' | 'resolved'; assignToMe?: boolean }) {
  if (change.status) await db.query(`UPDATE support_requests SET status=$2, updated_at=now() WHERE id=$1`, [id, change.status]);
  if (change.assignToMe) await db.query(`UPDATE support_requests SET assigned_to=$2, updated_at=now() WHERE id=$1`, [id, staffId]);
  await audit(db, { actor: staffId, action: 'support.updated', entityType: 'support_request', entityId: id, details: change });
}
