import type { Db } from '../db';
import { maskPhone, normalizePhone } from '../phone';

/**
 * Support tools: find a pledger by phone (they have no account) and see recent messages, e.g. when someone says
 * "I never got my code". Phone numbers are masked unless the staff role may see full numbers.
 */
export async function findPledger(db: Db, rawPhone: string, fullPhones: boolean) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  const [p] = await db.query(`SELECT id, name, phone, created_at, consent_version, opted_out FROM pledgers WHERE phone=$1`, [phone]);
  if (!p) return { phone: fullPhones ? phone : maskPhone(phone), pledger: null, pledges: [], messages: await messagesFor(db, phone, fullPhones) };
  const pledges = await db.query(
    `SELECT pg.created_at, pg.pay_plan, pg.due_date::text AS due, pg.access_token, e.title, e.id AS event_id, (pg.disputed_at IS NOT NULL) AS disputed,
            (-COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.pledge_id=pg.id AND le.account='pledge_income'),0))::bigint AS amount,
            GREATEST(COALESCE((SELECT SUM(amount) FROM ledger_entries le WHERE le.pledge_id=pg.id AND le.account='receivable'),0),0)::bigint AS balance
       FROM pledges pg JOIN events e ON e.id=pg.event_id WHERE pg.pledger_id=$1 ORDER BY pg.created_at DESC`,
    [p.id],
  );
  return {
    phone: fullPhones ? phone : maskPhone(phone),
    pledger: { name: p.name, since: p.created_at, consent: p.consent_version },
    pledges: pledges.map((x) => ({ ...x, amount: Number(x.amount), balance: Number(x.balance), access_token: undefined })),
    messages: await messagesFor(db, phone, fullPhones),
  };
}

async function messagesFor(db: Db, phone: string, fullPhones: boolean) {
  const rows = await db.query(
    `SELECT created_at, channel, purpose, status, delivery_status, error FROM messages_log WHERE recipient=$1 ORDER BY created_at DESC LIMIT 20`,
    [phone],
  );
  return rows.map((r) => ({ ...r, to: fullPhones ? phone : maskPhone(phone) }));
}

export async function recentMessages(db: Db, onlyFailed: boolean, fullPhones: boolean) {
  const rows = await db.query(
    `SELECT m.created_at, m.channel, m.purpose, m.status, m.delivery_status, m.error, m.recipient, e.title
       FROM messages_log m LEFT JOIN events e ON e.id=m.event_id
      WHERE ($1 = false OR m.status='failed' OR m.delivery_status='failed')
      ORDER BY m.created_at DESC LIMIT 60`,
    [onlyFailed],
  );
  return rows.map((r) => ({ ...r, recipient: typeof r.recipient === 'string' && r.recipient.startsWith('+') ? (fullPhones ? r.recipient : maskPhone(r.recipient)) : '—' }));
}
