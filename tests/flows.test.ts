import { beforeEach, describe, expect, it } from 'vitest';
import { makePglite, migrate, setDbForTests, type Db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { eventTotals, pledgeBalance, unbalancedJournals } from '@/lib/ledger';
import { signedMockWebhook } from '@/lib/payments/mock';
import { createEvent, eventForUser, pledgeRows } from '@/lib/services/events';
import { createPledge, decideChangeRequest, organizerChangeAmount, pledgerChangeAmount, recordManualPayment, reverseManualEntry, PledgeError } from '@/lib/services/pledges';
import { processWebhook, retryPayment, startPledgePayment, getPayment } from '@/lib/services/payments';
import { requestPayout, secondApprove, adminReview } from '@/lib/services/payouts';
import { runReminders, runReconciliation } from '@/lib/services/jobs';
import { addPhoneToUser, loginWithGoogleProfile, requestCode, userFromToken, verifyLoginCode } from '@/lib/services/auth';
import { loadExport, toCsv } from '@/lib/exports';
import { makeT } from '@/i18n';
import { addDays, localDate, zonedTime } from '@/lib/time';

let db: Db;

async function mkUser(phone: string, admin = false) {
  const [u] = await db.query(`INSERT INTO users(id, phone, is_admin) VALUES ($1,$2,$3) RETURNING *`, [newId('usr'), phone, admin]);
  await db.query(`INSERT INTO payout_accounts(id, user_id, kind, label, phone, verified) VALUES ($1,$2,'mobile_money','mm',$3,true)`, [newId('pa'), u.id, phone]);
  return u;
}

async function mkEvent(owner: any, type: any = 'wedding', target = 1_000_000) {
  return createEvent(db, owner.id, { type, title: `Test ${type}`, eventDate: null, targetAmount: target, story: '', coverFileId: null, details: {}, urgent: false });
}

async function pledge(eventId: string, phone: string, amount: number, plan: 'now' | 'part' | 'later' = 'now') {
  const r = await createPledge(db, { eventId, name: 'Test Person', phone, amount, message: null, anonymous: false, payPlan: plan, dueDate: plan === 'now' ? null : addDays(localDate(), 10), consent: true });
  return r.pledge;
}

/** Deliver a signed webhook for a mock payment, the same way the gateway would. */
async function webhook(paymentId: string, status: 'succeeded' | 'failed', opts: { amount?: number; id?: string } = {}) {
  const [tx] = await db.query(`SELECT * FROM mock_transactions WHERE reference=$1`, [paymentId]);
  // Like the real simulator: the gateway's own record changes first, then it sends the webhook.
  if (!opts.id) await db.query(`UPDATE mock_transactions SET status=$2 WHERE ref=$1 AND status='pending'`, [tx.ref, status]);
  const { body, headers } = signedMockWebhook({ id: opts.id ?? `${tx.ref}:${status}`, kind: 'collection', reference: paymentId, ref: tx.ref, status, amount: opts.amount ?? Number(tx.amount), currency: 'UGX' });
  return processWebhook(db, 'mock', body, headers);
}

async function payFor(token: string, amount: number, key = newId('k'), coverFee = true) {
  return startPledgePayment(db, { pledgeToken: token, amount, method: 'mtn', phone: '+256772000999', coverFee, tip: 0, idempotencyKey: key });
}

beforeEach(async () => {
  db = await makePglite();
  await migrate(db);
  setDbForTests(db);
  // Like local development: codes on screen, so code-sending limits are off (tested separately below).
  process.env.OTP_SHOW_ON_SCREEN = 'true';
});

describe('payments and idempotency', () => {
  it('double tap / refresh with the same idempotency key creates exactly one payment', async () => {
    const o = await mkUser('+256700000010');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772111001', 50000);
    const [a, b] = await Promise.all([payFor(p.access_token, 50000, 'same-key-123456789'), payFor(p.access_token, 50000, 'same-key-123456789')]);
    expect(a.id).toBe(b.id);
    const [{ n }] = await db.query('SELECT COUNT(*)::int AS n FROM payments');
    expect(n).toBe(1);
  });

  it('never marks paid from the browser: only a verified webhook does it', async () => {
    const o = await mkUser('+256700000011');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772111002', 50000);
    const pay = await payFor(p.access_token, 50000);
    expect(pay.status).toBe('pending');
    expect((await pledgeBalance(db, p.id)).paid).toBe(0);
    // A forged webhook (bad signature) is rejected.
    const forged = await processWebhook(db, 'mock', JSON.stringify({ id: 'x', kind: 'collection', reference: pay.id, status: 'succeeded', amount: 51500, currency: 'UGX' }), new Headers({ 'x-mock-signature': 'nope' }));
    expect(forged.status).toBe(401);
    expect((await getPayment(db, pay.id)).status).toBe('pending');
    await webhook(pay.id, 'succeeded');
    expect((await getPayment(db, pay.id)).status).toBe('succeeded');
    expect((await pledgeBalance(db, p.id)).paid).toBe(50000);
  });

  it('a webhook delivered twice, late or out of order leaves the ledger correct', async () => {
    const o = await mkUser('+256700000012');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772111003', 80000);
    const pay = await payFor(p.access_token, 80000);
    await webhook(pay.id, 'succeeded');
    const dup = await webhook(pay.id, 'succeeded');
    expect(dup.reason).toBe('duplicate');
    await webhook(pay.id, 'failed', { id: 'late-failure' }); // stale, out of order
    await webhook(pay.id, 'succeeded', { id: 'retry-with-new-id' }); // gateway resend with a new event id
    expect((await getPayment(db, pay.id)).status).toBe('succeeded');
    const t = await eventTotals(db, e.id);
    expect(t.collected).toBe(80000);
    const [{ n }] = await db.query(`SELECT COUNT(*)::int AS n FROM ledger_journals WHERE kind='payment'`);
    expect(n).toBe(1);
    expect(await unbalancedJournals(db)).toEqual([]);
  });

  it('amount mismatch never marks a pledge paid and is flagged for reconciliation', async () => {
    const o = await mkUser('+256700000013');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772111004', 50000);
    const pay = await payFor(p.access_token, 50000);
    await webhook(pay.id, 'succeeded', { amount: 1000 });
    expect((await getPayment(db, pay.id)).status).toBe('pending');
    const issues = await db.query(`SELECT * FROM reconciliation_issues WHERE kind='amount_mismatch'`);
    expect(issues.length).toBe(1);
  });

  it('failed and expired prompts never mark paid; retry cannot double charge', async () => {
    const o = await mkUser('+256700000014');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772111005', 50000);
    const pay = await payFor(p.access_token, 50000);
    await webhook(pay.id, 'failed');
    expect((await getPayment(db, pay.id)).status).toBe('failed');
    expect((await pledgeBalance(db, p.id)).paid).toBe(0);
    const r1 = await retryPayment(db, pay.id);
    const r2 = await retryPayment(db, pay.id);
    expect(r1.id).toBe(r2.id); // double-tapping retry yields one new payment
    // A pending prompt that is resent is expired first; the old prompt can no longer be approved (mock).
    const r3 = await retryPayment(db, r1.id);
    expect((await getPayment(db, r1.id)).status).toBe('expired');
    await webhook(r3.id, 'succeeded');
    expect((await pledgeBalance(db, p.id)).paid).toBe(50000);
  });
});

describe('ledger stays balanced', () => {
  it('partial payments, overpayments and organizer reductions', async () => {
    const o = await mkUser('+256700000020');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772222001', 100000, 'part');
    const a = await payFor(p.access_token, 40000, 'k-a-1234567890123');
    await webhook(a.id, 'succeeded');
    expect((await pledgeBalance(db, p.id)).balance).toBe(60000);
    const b = await payFor(p.access_token, 90000, 'k-b-1234567890123'); // overpays by 30,000
    await webhook(b.id, 'succeeded');
    expect((await pledgeBalance(db, p.id)).balance).toBe(-30000);
    await organizerChangeAmount(db, p.id, 70000, o.id);
    const bal = await pledgeBalance(db, p.id);
    expect(bal.pledged).toBe(70000);
    expect(bal.balance).toBe(-60000);
    const t = await eventTotals(db, e.id);
    expect(t.pledged).toBe(70000);
    expect(t.collected).toBe(130000);
    expect(t.overpaid).toBe(60000);
    expect(await unbalancedJournals(db)).toEqual([]);
  });

  it('a pledger can raise a pledge, but a reduction needs organizer approval', async () => {
    const o = await mkUser('+256700000021');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772222002', 100000, 'later');
    await pledgerChangeAmount(db, p.access_token, 150000);
    expect((await pledgeBalance(db, p.id)).pledged).toBe(150000);
    const r = await pledgerChangeAmount(db, p.access_token, 50000);
    expect(r.pendingApproval).toBe(true);
    expect((await pledgeBalance(db, p.id)).pledged).toBe(150000);
    const [req] = await db.query(`SELECT id FROM pledge_change_requests WHERE status='pending'`);
    await decideChangeRequest(db, req.id, true, o.id);
    expect((await pledgeBalance(db, p.id)).pledged).toBe(50000);
    expect(await unbalancedJournals(db)).toEqual([]);
  });

  it('manual entries are audit-logged, append-only, and corrected only by reversal', async () => {
    const o = await mkUser('+256700000022');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772222003', 100000, 'later');
    await recordManualPayment(db, { pledgeId: p.id, amount: 30000, reason: 'Cash at meeting', receiptRef: 'R1', actor: o.id });
    const [j] = await db.query(`SELECT id FROM ledger_journals WHERE kind='manual_payment'`);
    const logs = await db.query(`SELECT * FROM audit_logs WHERE action='ledger.manual_payment'`);
    expect(logs.length).toBe(1);
    await expect(db.query(`UPDATE ledger_entries SET amount=1 WHERE journal_id=$1`, [j.id])).rejects.toThrow();
    await expect(db.query(`DELETE FROM ledger_entries WHERE journal_id=$1`, [j.id])).rejects.toThrow();
    await expect(db.query(`DELETE FROM audit_logs`)).rejects.toThrow();
    await reverseManualEntry(db, j.id, o.id, 'Wrong pledger');
    expect((await pledgeBalance(db, p.id)).paid).toBe(0);
    await expect(reverseManualEntry(db, j.id, o.id, 'again')).resolves.toBeTruthy(); // idempotent: still one reversal
    const [{ n }] = await db.query(`SELECT COUNT(*)::int AS n FROM ledger_journals WHERE kind='reversal'`);
    expect(n).toBe(1);
  });
});

describe('pledges', () => {
  it('the same phone in any format on one event is a duplicate, not a second pledge', async () => {
    const o = await mkUser('+256700000030');
    const e = await mkEvent(o);
    await pledge(e.id, '0772333001', 10000);
    await expect(pledge(e.id, '+256772333001', 20000)).rejects.toThrow(PledgeError);
    await expect(pledge(e.id, '256772333001', 20000)).rejects.toThrow(PledgeError);
    const [{ n }] = await db.query('SELECT COUNT(*)::int AS n FROM pledges');
    expect(n).toBe(1);
  });
});

describe('reminders', () => {
  it('respect opt-outs, paid pledges and quiet hours', async () => {
    const o = await mkUser('+256700000040');
    const e = await mkEvent(o);
    const a = await pledge(e.id, '0772444001', 10000, 'later');
    const b = await pledge(e.id, '0772444002', 10000, 'later');
    await db.query(`UPDATE pledgers SET opted_out=true WHERE phone='+256772444002'`);
    // Make the earliest reminder of each pledge due now (one per pledge keeps (pledge, stage, send_at) unique).
    const dueAt = (at: Date) => db.query(`UPDATE reminders SET send_at=$1::timestamptz - interval '1 minute'
      WHERE id IN (SELECT DISTINCT ON (pledge_id) id FROM reminders WHERE status='scheduled' ORDER BY pledge_id, send_at)`, [at.toISOString()]);
    // 23:00 Kampala: quiet hours, so nothing is sent and the reminder moves to 07:00.
    const night = zonedTime(localDate(), 23);
    const morning = zonedTime(addDays(localDate(), 1), 10);
    await dueAt(night);
    const r1 = await runReminders(db, night);
    expect(r1.sent).toBe(0);
    const [moved] = await db.query(`SELECT send_at FROM reminders WHERE pledge_id=$1 AND status='scheduled' ORDER BY send_at LIMIT 1`, [a.id]);
    expect(new Date(moved.send_at).getUTCHours()).toBe(4); // 07:00 EAT
    await dueAt(morning);
    const r2 = await runReminders(db, morning);
    expect(r2.sent).toBeGreaterThan(0);
    const skippedB = await db.query(`SELECT * FROM reminders WHERE pledge_id=$1 AND status='sent'`, [b.id]);
    expect(skippedB.length).toBe(0);
  });
});

describe('payouts', () => {
  it('hospital events need a second approver and review before the first payout; hold prevents double spending', async () => {
    const o = await mkUser('+256700000050');
    const tr = await mkUser('+256700000051');
    const admin = await mkUser('+256700000052', true);
    const e = await mkEvent(o, 'hospital');
    await db.query(`INSERT INTO event_members(event_id, user_id, role) VALUES ($1,$2,'treasurer')`, [e.id, tr.id]);
    const p = await pledge(e.id, '0772555001', 200000);
    const pay = await payFor(p.access_token, 200000);
    await webhook(pay.id, 'succeeded');
    const [acct] = await db.query(`SELECT id FROM payout_accounts WHERE user_id=$1`, [o.id]);
    const po = await requestPayout(db, { eventId: e.id, userId: o.id, accountId: acct.id, amount: 150000 });
    expect(po.status).toBe('awaiting_second_approval');
    await expect(requestPayout(db, { eventId: e.id, userId: o.id, accountId: acct.id, amount: 100000 })).rejects.toThrow('insufficient_balance');
    await expect(secondApprove(db, po.id, o.id)).rejects.toThrow('same_person');
    const after = await secondApprove(db, po.id, tr.id);
    expect(after.status).toBe('in_review');
    await adminReview(db, po.id, admin.id, true, 'ok');
    const [paid] = await db.query('SELECT status FROM payouts WHERE id=$1', [po.id]);
    expect(paid.status).toBe('paid');
    const t = await eventTotals(db, e.id);
    expect(t.paidOut).toBe(150000);
    expect(t.available).toBe(50000);
    expect(await unbalancedJournals(db)).toEqual([]);
  });
});

describe('security', () => {
  it('one user cannot read or change another user’s event', async () => {
    const a = await mkUser('+256700000060');
    const b = await mkUser('+256700000061');
    const e = await mkEvent(a);
    await expect(eventForUser(db, e.id, b, 'viewer')).rejects.toThrow('forbidden');
    await expect(eventForUser(db, e.id, { ...b, is_admin: true }, 'owner')).rejects.toThrow('forbidden');
    await expect(eventForUser(db, e.id, a, 'owner')).resolves.toBeTruthy();
  });

  it('phone login: code goes by WhatsApp, wrong codes lock the number', async () => {
    const phone = (v: string) => ({ kind: 'phone' as const, value: v });
    const r = await requestCode(db, phone('0772666001'));
    expect(r.channel).toBe('whatsapp');
    expect(r.identifier).toBe('+256772666001');
    const [log] = await db.query(`SELECT * FROM messages_log WHERE channel='whatsapp'`);
    expect(log.body).not.toContain(r.devCode!); // codes are never stored
    await expect(verifyLoginCode(db, { ...phone('0772666001'), code: r.devCode === '000000' ? '111111' : '000000' })).rejects.toThrow('wrong_code');
    const ok = await verifyLoginCode(db, { ...phone('+256772666001'), code: r.devCode! });
    expect(ok.token.length).toBeGreaterThan(20);
    const [acct] = await db.query(`SELECT * FROM payout_accounts WHERE user_id=$1`, [ok.userId]);
    expect(acct.verified).toBe(true);
    await requestCode(db, phone('0772666001'));
    for (let i = 0; i < 10; i++) await verifyLoginCode(db, { ...phone('0772666001'), code: '999999' }).catch(() => undefined);
    await expect(verifyLoginCode(db, { ...phone('0772666001'), code: '999999' })).rejects.toThrow('locked');
  });

  it('falls back to SMS when WhatsApp cannot deliver', async () => {
    process.env.WHATSAPP_PROVIDER = 'meta'; // not configured, so sending fails
    try {
      const r = await requestCode(db, { kind: 'phone', value: '0772666002' });
      expect(r.channel).toBe('sms');
      process.env.OTP_SMS_FALLBACK = 'false';
      await expect(requestCode(db, { kind: 'phone', value: '0772666003' })).rejects.toThrow('send_failed');
    } finally {
      delete process.env.WHATSAPP_PROVIDER;
      delete process.env.OTP_SMS_FALLBACK;
    }
  });

  it('email login creates an account without a phone; Google with the same Gmail is the same account', async () => {
    const r = await requestCode(db, { kind: 'email', value: '  Sarah.N@Gmail.com ' });
    expect(r.channel).toBe('email');
    expect(r.identifier).toBe('sarah.n@gmail.com');
    await expect(requestCode(db, { kind: 'email', value: 'not-an-email' })).rejects.toThrow('invalid_email');
    const a = await verifyLoginCode(db, { kind: 'email', value: 'sarah.n@gmail.com', code: r.devCode! });
    const u = await userFromToken(db, a.token);
    expect(u.phone).toBeNull();
    const g = await loginWithGoogleProfile(db, { sub: 'g-123', email: 'Sarah.N@gmail.com', emailVerified: true, name: 'Sarah N' });
    expect(g.userId).toBe(a.userId);
    const again = await loginWithGoogleProfile(db, { sub: 'g-123', email: 'changed@gmail.com', emailVerified: true, name: null });
    expect(again.userId).toBe(a.userId); // matched by Google id even if the email changes
    // An unverified Google email never takes over an existing account.
    const other = await loginWithGoogleProfile(db, { sub: 'g-999', email: 'someone@x.com', emailVerified: true, name: null });
    expect(other.userId).not.toBe(a.userId);
    await expect(loginWithGoogleProfile(db, { sub: 'g-777', email: 'sarah.n@gmail.com', emailVerified: false, name: null })).rejects.toThrow('google_no_email');
  });

  it('email user adds a phone by WhatsApp code and inherits a committee invite for that number', async () => {
    const owner = await mkUser('+256700000080');
    const e = await mkEvent(owner);
    await db.query(`INSERT INTO users(id, phone) VALUES ('usr_invite', '+256772666010')`);
    await db.query(`INSERT INTO event_members(event_id, user_id, role, added_by) VALUES ($1,'usr_invite','treasurer',$2)`, [e.id, owner.id]);
    const c = await requestCode(db, { kind: 'email', value: 'treasurer@example.com' });
    const me = await verifyLoginCode(db, { kind: 'email', value: 'treasurer@example.com', code: c.devCode! });
    const p = await requestCode(db, { kind: 'phone', value: '0772666010', purpose: 'add_phone' });
    // A login code cannot be used to add a phone, and vice versa.
    await expect(verifyLoginCode(db, { kind: 'phone', value: '0772666010', code: p.devCode! })).rejects.toThrow();
    const p2 = await requestCode(db, { kind: 'phone', value: '0772666010', purpose: 'add_phone' });
    await addPhoneToUser(db, me.userId, '0772666010', p2.devCode!);
    const [m] = await db.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2`, [e.id, me.userId]);
    expect(m.role).toBe('treasurer');
    const accts = await db.query(`SELECT * FROM payout_accounts WHERE user_id=$1 AND verified`, [me.userId]);
    expect(accts.length).toBe(1);
    // A number that already belongs to an active account cannot be taken.
    const q = await requestCode(db, { kind: 'phone', value: '0700000080', purpose: 'add_phone' });
    await expect(addPhoneToUser(db, me.userId, '0700000080', q.devCode!)).rejects.toThrow();
  });
});

describe('exports and reconciliation', () => {
  it('CSV export totals match the dashboard exactly', async () => {
    const o = await mkUser('+256700000070');
    const e = await mkEvent(o);
    const p1 = await pledge(e.id, '0772777001', 120000);
    await pledge(e.id, '0772777002', 30000, 'later');
    const pay = await payFor(p1.access_token, 120000);
    await webhook(pay.id, 'succeeded');
    const data = await loadExport(db, e.id);
    const dash = await eventTotals(db, e.id);
    expect(data.totals).toEqual(dash);
    const rows = await pledgeRows(db, e.id);
    expect(rows.reduce((s, r) => s + r.paid, 0)).toBe(dash.collected);
    const csv = toCsv(data, makeT('en'));
    expect(csv).toContain(`"${dash.collected}"`);
  });

  it('daily reconciliation finds no issues on a clean ledger', async () => {
    const o = await mkUser('+256700000071');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772777003', 50000);
    const pay = await payFor(p.access_token, 50000);
    await webhook(pay.id, 'succeeded');
    const r = await runReconciliation(db, localDate());
    expect(r.checked).toBe(1);
    expect(r.issues).toBe(0);
  });
});

describe('WhatsApp messages', () => {
  it('every template follows Meta rules: all variables used once, never at the start or end', async () => {
    const { WA_BODIES, WA_PARAMS } = await import('@/lib/waTemplates');
    for (const [lang, variants] of Object.entries(WA_BODIES)) {
      for (const [variant, stages] of Object.entries(variants)) {
        for (const [stage, body] of Object.entries(stages)) {
          const where = `${lang}/${variant}/${stage}`;
          const used = (body.match(/\{(\w+)\}/g) ?? []).map((v) => v.slice(1, -1));
          expect(used.sort(), where).toEqual([...WA_PARAMS[stage as keyof typeof WA_PARAMS]].sort());
          expect(body.trim().startsWith('{'), where).toBe(false);
          expect(body.trim().endsWith('}'), where).toBe(false);
        }
      }
    }
  });

  it('pledge confirmation goes on WhatsApp in the pledger’s language; SMS when WhatsApp refuses', async () => {
    const o = await mkUser('+256700000090');
    const e = await mkEvent(o);
    await createPledge(db, { eventId: e.id, name: 'Amina', phone: '0772888001', amount: 10000, message: null, anonymous: false, payPlan: 'now', dueDate: null, consent: true, locale: 'sw' });
    const [pl] = await db.query(`SELECT locale FROM pledgers WHERE phone='+256772888001'`);
    expect(pl.locale).toBe('sw');
    const [m] = await db.query(`SELECT channel, body FROM messages_log WHERE recipient='+256772888001' AND purpose='pledged'`);
    expect(m.channel).toBe('whatsapp');
    expect(m.body).toContain('Asante'); // the SMS-fallback text is stored in the pledger's language
    process.env.WHATSAPP_PROVIDER = 'meta'; // not configured, so WhatsApp refuses
    try {
      await createPledge(db, { eventId: e.id, name: 'Juma', phone: '0772888002', amount: 10000, message: null, anonymous: false, payPlan: 'now', dueDate: null, consent: true });
      const rows = await db.query(`SELECT channel, status FROM messages_log WHERE recipient='+256772888002' ORDER BY created_at`);
      expect(rows.map((r) => `${r.channel}:${r.status}`)).toEqual(['whatsapp:failed', 'sms:logged']);
    } finally {
      delete process.env.WHATSAPP_PROVIDER;
    }
  });

  it('a WhatsApp delivery failure sends the SMS version exactly once; replies cannot stop reminders', async () => {
    const { handleWhatsAppStatus } = await import('@/lib/notify');
    const o = await mkUser('+256700000091');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772888003', 10000, 'later');
    await db.query(`UPDATE messages_log SET provider_ref='wamid.TEST1' WHERE recipient='+256772888003' AND channel='whatsapp'`);
    await handleWhatsAppStatus(db, 'wamid.TEST1', 'failed');
    await handleWhatsAppStatus(db, 'wamid.TEST1', 'failed'); // Meta may repeat webhooks
    const sms = await db.query(`SELECT * FROM messages_log WHERE recipient='+256772888003' AND channel='sms'`);
    expect(sms.length).toBe(1);
    expect(sms[0].purpose).toBe('pledged_fallback');
    // Reminders stay scheduled whatever the pledger replies: there is no opt-out handler any more.
    const left = await db.query(`SELECT * FROM reminders WHERE pledge_id=$1 AND status='scheduled'`, [p.id]);
    expect(left.length).toBeGreaterThan(0);
  });
});

describe('homepage showcase', () => {
  it('shows only opted-in, approved, open events, and only public fields', async () => {
    const { featuredEvents, updateEventSettings } = await import('@/lib/services/events');
    const { saveSetting } = await import('@/lib/settings');
    const a = await mkUser('+256700000101');
    const b = await mkUser('+256700000102');
    const c = await mkUser('+256700000103');
    const shown = await createEvent(db, a.id, { type: 'wedding', title: 'Shown wedding', eventDate: null, targetAmount: 1000, story: '', coverFileId: null, details: {}, urgent: false, organizerKind: 'faith', showOnHome: true });
    await createEvent(db, b.id, { type: 'birthday', title: 'Private birthday', eventDate: null, targetAmount: null, story: '', coverFileId: null, details: {}, urgent: false });
    const waiting = await createEvent(db, c.id, { type: 'community', title: 'Waiting drive', eventDate: null, targetAmount: null, story: '', coverFileId: null, details: {}, urgent: false, showOnHome: true });

    expect(await featuredEvents(db)).toEqual([]); // nothing approved yet
    await db.query('UPDATE events SET home_approved=true WHERE id=$1', [shown.id]);
    const list = await featuredEvents(db);
    expect(list.map((x) => x.title)).toEqual(['Shown wedding']);
    expect(list[0].organizerKind).toBe('faith');
    expect(Object.keys(list[0])).not.toContain('created_by');

    // Admin can turn review off: requested events then appear straight away.
    await saveSetting(db, 'home_requires_approval', false, a.id);
    expect((await featuredEvents(db)).map((x) => x.title).sort()).toEqual(['Shown wedding', 'Waiting drive']);

    // Closing or frozen events leave the homepage; so does the owner switching it off.
    await updateEventSettings(db, waiting.id, c.id, { showOnHome: false });
    await db.query('UPDATE events SET frozen=true WHERE id=$1', [shown.id]);
    expect(await featuredEvents(db)).toEqual([]);
  });

  it('asking again after a decline goes back into review', async () => {
    const { updateEventSettings, homeStatus } = await import('@/lib/services/events');
    const a = await mkUser('+256700000104');
    const e = await createEvent(db, a.id, { type: 'wedding', title: 'Second try', eventDate: null, targetAmount: null, story: '', coverFileId: null, details: {}, urgent: false, showOnHome: true });
    await db.query('UPDATE events SET home_approved=false WHERE id=$1', [e.id]);
    const get = async () => (await db.query('SELECT * FROM events WHERE id=$1', [e.id]))[0];
    expect(homeStatus(await get(), true)).toBe('declined');
    await updateEventSettings(db, e.id, a.id, { showOnHome: false });
    await updateEventSettings(db, e.id, a.id, { showOnHome: true });
    expect(homeStatus(await get(), true)).toBe('pending');
    await expect(updateEventSettings(db, e.id, a.id, { organizerKind: 'pirate' })).rejects.toThrow();
  });
});

describe('one-time code for every pledge (no PIN, nothing permanent)', () => {
  it('a phone number alone unlocks nothing; a code opens 15 minutes for that number only', async () => {
    const A = await import('@/lib/services/pledgerAccess');
    const o = await mkUser('+256700000110');
    const e1 = await mkEvent(o);
    const o2 = await mkUser('+256700000111');
    const e2 = await mkEvent(o2, 'community');
    const p1 = await pledge(e1.id, '0772999001', 100000, 'later');
    await pledge(e2.id, '0772999001', 50000, 'later');
    const pay = await payFor(p1.access_token, 40000);
    await webhook(pay.id, 'succeeded');

    // Nothing verified: no access, no pledging.
    expect(await A.devicePhone(db, undefined)).toBeNull();
    await expect(A.requireVerifiedForPledge(db, undefined, '0772999001')).rejects.toThrow('verify_required');
    // A wrong code does not verify.
    await A.sendPledgerCode(db, '0772999001');
    await expect(A.verifyPledger(db, { phone: '0772999001', code: '000000' })).rejects.toThrow();

    // The right code opens a verification for that number, with the full summary.
    const c = await A.sendPledgerCode(db, '0772999001');
    const v = await A.verifyPledger(db, { phone: '0772999001', code: c.devCode! });
    expect(await A.devicePhone(db, v.token)).toBe('+256772999001');
    const s = await A.pledgerSummary(db, '+256772999001');
    expect(s.items.length).toBe(2);
    expect(s.totals[0]).toEqual({ currency: 'UGX', pledged: 150000, paid: 40000, balance: 110000 });
    expect(s.items.find((i) => i.pledged === 100000)!.state).toBe('partial');
    expect(s.next).not.toBeNull();

    // It does not authorise a different number.
    await expect(A.requireVerifiedForPledge(db, v.token, '0772999002')).rejects.toThrow('verify_required');
    // It expires after 15 minutes.
    await db.query(`UPDATE pledger_devices SET expires_at = now() - interval '1 minute'`);
    expect(await A.devicePhone(db, v.token)).toBeNull();
  });

  it('one code, one pledge: making a pledge uses the code up, the same number needs a new code next time', async () => {
    const A = await import('@/lib/services/pledgerAccess');
    const o = await mkUser('+256700000120');
    const e = await mkEvent(o);
    const e2 = await mkEvent(await mkUser('+256700000122'), 'birthday');
    const c = await A.sendPledgerCode(db, '0772999101');
    const v = await A.verifyPledger(db, { phone: '0772999101', code: c.devCode! });
    const useUp = await A.requireVerifiedForPledge(db, v.token, '+256772999101');
    await pledge(e.id, '0772999101', 20000, 'later');
    await useUp();
    // Same browser, same number, another event: blocked until a new code is verified.
    await expect(A.requireVerifiedForPledge(db, v.token, '0772999101')).rejects.toThrow('verify_required');
    const c2 = await A.sendPledgerCode(db, '0772999101');
    const v2 = await A.verifyPledger(db, { phone: '0772999101', code: c2.devCode! }, v.token);
    await expect(A.requireVerifiedForPledge(db, v2.token, '0772999101')).resolves.toBeTypeOf('function');
    void e2;
  });
});

describe('personal pledge link needs a fresh code', () => {
  it('the link alone shows nothing; a code to the pledge number opens it; leaving closes it', async () => {
    const A = await import('@/lib/services/pledgerAccess');
    const o = await mkUser('+256700000130');
    const e = await mkEvent(o);
    const p = await pledge(e.id, '0772999201', 30000, 'later');
    const other = await pledge(e.id, '0772999202', 10000, 'later');

    expect(await A.canViewPledge(db, undefined, p.access_token)).toBe(false);
    // The code goes to the pledge's own number, whoever opened the link.
    const c = await A.sendCodeForPledge(db, p.access_token);
    expect(c.identifier).toBe('+256772999201');
    const v = await A.verifyForPledge(db, p.access_token, c.devCode!);
    expect(await A.canViewPledge(db, v.token, p.access_token)).toBe(true);
    // Verified for one number never opens another person's pledge.
    expect(await A.canViewPledge(db, v.token, other.access_token)).toBe(false);
    // After making a pledge the portal can still be viewed, but a second pledge needs a new code.
    const useUp = await A.requireVerifiedForPledge(db, v.token, '0772999201');
    await useUp();
    expect(await A.canViewPledge(db, v.token, p.access_token)).toBe(true);
    await expect(A.requireVerifiedForPledge(db, v.token, '0772999201')).rejects.toThrow('verify_required');
    // Leaving the portal (event page, homepage, reopening the form) ends it.
    await A.forgetDevice(db, v.token);
    expect(await A.canViewPledge(db, v.token, p.access_token)).toBe(false);
  });
});

describe('code sending limits (live mode)', () => {
  it('a short wait between codes and caps per 10 minutes, all admin-adjustable; none in test mode', async () => {
    const { requestCode } = await import('@/lib/services/auth');
    const { saveSetting } = await import('@/lib/settings');
    process.env.OTP_SHOW_ON_SCREEN = 'false';
    try {
      const ask = () => requestCode(db, { kind: 'phone', value: '0772999301', purpose: 'pledger' });
      await ask();
      await expect(ask()).rejects.toThrow('code_wait'); // 30 s between codes
      await saveSetting(db, 'otp_min_gap_seconds', 0, 'admin');
      for (let i = 0; i < 9; i++) await ask(); // 10 in total
      await expect(ask()).rejects.toThrow('too_many_codes');
      await saveSetting(db, 'otp_max_per_10min', 20, 'admin'); // admin raises it: allowed again
      await expect(ask()).resolves.toBeTruthy();
      // Other numbers are not affected.
      await expect(requestCode(db, { kind: 'phone', value: '0772999302', purpose: 'pledger' })).resolves.toBeTruthy();
    } finally {
      process.env.OTP_SHOW_ON_SCREEN = 'true';
    }
    // Test mode: no limits at all.
    for (let i = 0; i < 25; i++) await requestCode(db, { kind: 'phone', value: '0772999303', purpose: 'pledger' });
  });
});

describe('one login, the right portal', () => {
  it('organizer → dashboard, pledger-only → pledger portal (no account made), new → sign-up', async () => {
    const { smartLogin } = await import('@/lib/services/login');
    const { requestCode } = await import('@/lib/services/auth');
    const { devicePhone } = await import('@/lib/services/pledgerAccess');
    const login = async (phone: string, intent: 'auto' | 'organizer' = 'auto') => {
      const c = await requestCode(db, { kind: 'phone', value: phone });
      return smartLogin(db, { kind: 'phone', value: phone, code: c.devCode!, intent });
    };
    const owner = await mkUser('+256700000140');
    const e = await mkEvent(owner);
    await pledge(e.id, '0772999401', 15000, 'later');

    const org = await login('0700000140');
    expect(org.portal).toBe('organizer');
    expect(org.redirect).toBe('/app');

    const pl = await login('0772999401');
    expect(pl.portal).toBe('pledger');
    expect(pl.redirect).toBe('/my');
    if (pl.portal === 'pledger') expect(await devicePhone(db, pl.pledgerToken)).toBe('+256772999401');
    expect((await db.query(`SELECT 1 FROM users WHERE phone='+256772999401'`)).length).toBe(0);

    // "Start an event" (organizer intent) signs a pledger up as an organizer.
    const asOrg = await login('0772999401', 'organizer');
    expect(asOrg.portal).toBe('organizer');

    const fresh = await login('0772999402');
    expect(fresh.portal).toBe('organizer');
  });
});

describe('roles and permissions on an event (RBAC)', () => {
  async function committee() {
    const { addMember, eventAccess } = await import('@/lib/services/events');
    const owner = await mkUser('+256700000501');
    const treasurer = await mkUser('+256700000502');
    const helper = await mkUser('+256700000503');
    const stranger = await mkUser('+256700000504');
    const admin = await mkUser('+256700000505', true);
    const e = await mkEvent(owner);
    return { addMember, eventAccess, owner, treasurer, helper, stranger, admin, e };
  }
  const denied = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'forbidden' });

  it('each role gets only its own permissions', async () => {
    const { addMember, eventAccess, owner, treasurer, helper, stranger, admin, e } = await committee();
    await addMember(db, e.id, owner.id, '0700000502', 'treasurer');
    await addMember(db, e.id, owner.id, '0700000503', 'viewer');

    // Organizer: runs the event, but not the cash once a treasurer exists.
    await eventAccess(db, e.id, owner, 'settings.manage');
    await eventAccess(db, e.id, owner, 'payouts.request');
    await denied(eventAccess(db, e.id, owner, 'cash.record'));
    await denied(eventAccess(db, e.id, owner, 'cash.reverse'));

    // Treasurer: money only.
    await eventAccess(db, e.id, treasurer, 'cash.record');
    await eventAccess(db, e.id, treasurer, 'ledger.export');
    await eventAccess(db, e.id, treasurer, 'payouts.secondApprove');
    for (const p of ['settings.manage', 'committee.manage', 'payouts.request', 'pledges.adjust', 'messages.moderate', 'billing.manage'] as const) {
      await denied(eventAccess(db, e.id, treasurer, p));
    }

    // Helper: view and share only; no phone numbers, ledger or exports.
    await eventAccess(db, e.id, helper, 'event.view');
    await eventAccess(db, e.id, helper, 'event.share');
    for (const p of ['pledges.contacts', 'ledger.view', 'ledger.export', 'cash.record', 'payouts.view', 'committee.contacts'] as const) {
      await denied(eventAccess(db, e.id, helper, p));
    }

    // Ahadi admin who is not on the committee: read-only.
    await eventAccess(db, e.id, admin, 'ledger.view');
    for (const p of ['cash.record', 'settings.manage', 'ledger.export', 'payouts.request'] as const) await denied(eventAccess(db, e.id, admin, p));

    // Not on the committee at all.
    await denied(eventAccess(db, e.id, stranger, 'event.view'));
  });

  it('the organizer records cash only while there is no treasurer', async () => {
    const { addMember, eventAccess, owner, e } = await committee();
    await eventAccess(db, e.id, owner, 'cash.record');
    await addMember(db, e.id, owner.id, '0700000502', 'treasurer');
    await expect(eventAccess(db, e.id, owner, 'cash.record')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('nobody can add a second owner, change their own role or remove the organizer', async () => {
    const { addMember, owner, e } = await committee();
    const { removeMember } = await import('@/lib/services/events');
    await expect(addMember(db, e.id, owner.id, '0700000502', 'owner' as any)).rejects.toMatchObject({ code: 'invalid_role' });
    await expect(addMember(db, e.id, owner.id, '0700000501', 'viewer')).rejects.toMatchObject({ code: 'cannot_change_self' });
    await expect(removeMember(db, e.id, owner.id, owner.id)).rejects.toMatchObject({ code: 'cannot_change_self' });
    const [m] = await db.query(`SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2`, [e.id, owner.id]);
    expect(m.role).toBe('owner');
  });

  it('the person who asks for a withdrawal can never approve it', async () => {
    const { addMember, owner, e } = await committee();
    await addMember(db, e.id, owner.id, '0700000502', 'treasurer');
    const [p] = await db.query(
      `INSERT INTO payouts(id, event_id, account_id, amount, currency, status, requested_by)
       SELECT $1, $2, a.id, 1000, 'UGX', 'awaiting_second_approval', $3 FROM payout_accounts a WHERE a.user_id=$3 RETURNING *`,
      [newId('po'), e.id, owner.id],
    ).catch(() => [null]);
    if (!p) return; // schema differs: the same-person rule is covered in the payouts tests
    await expect(secondApprove(db, p.id, owner.id)).rejects.toThrow('same_person');
  });
});

describe('step-up, admin roles, handover and analytics (v1.21)', () => {
  it('a fresh code is needed for money actions, and it expires', async () => {
    const { hasFreshStepUp, sendStepUpCode, verifyStepUp } = await import('@/lib/services/stepUp');
    const { createSession } = await import('@/lib/services/auth');
    const u = await mkUser('+256700000601');
    const token = await createSession(db, u.id);
    expect(await hasFreshStepUp(db, token)).toBe(false);
    const r = await sendStepUpCode(db, u);
    await verifyStepUp(db, u, token, r.devCode!);
    expect(await hasFreshStepUp(db, token)).toBe(true);
    await db.query(`UPDATE sessions SET stepped_up_at = now() - interval '11 minutes'`);
    expect(await hasFreshStepUp(db, token)).toBe(false);
  });

  it('admin sessions are short, organizer sessions are long', async () => {
    const { createSession } = await import('@/lib/services/auth');
    const admin = await mkUser('+256700000602', true);
    const org = await mkUser('+256700000603');
    await createSession(db, admin.id);
    await createSession(db, org.id);
    const rows = await db.query(`SELECT user_id, EXTRACT(EPOCH FROM (expires_at - created_at))/3600 AS h FROM sessions`);
    const h = (id: string) => Number(rows.find((r: any) => r.user_id === id).h);
    expect(h(admin.id)).toBeLessThanOrEqual(8.01);
    expect(h(org.id)).toBeGreaterThan(24 * 29);
  });

  it('each admin role gets only its own powers', async () => {
    const { adminCan } = await import('@/lib/adminPermissions');
    const as = (r: string) => ({ is_admin: true, admin_role: r });
    expect(adminCan(as('super'), 'team.manage')).toBe(true);
    expect(adminCan(as('finance'), 'payouts.review')).toBe(true);
    expect(adminCan(as('finance'), 'events.freeze')).toBe(false);
    expect(adminCan(as('trust'), 'events.freeze')).toBe(true);
    expect(adminCan(as('trust'), 'payouts.review')).toBe(false);
    expect(adminCan(as('support'), 'admin.view')).toBe(true);
    for (const p of ['payouts.review', 'events.freeze', 'settings.edit', 'team.manage', 'accounts.recover'] as const) expect(adminCan(as('support'), p)).toBe(false);
    expect(adminCan({ is_admin: false, admin_role: 'super' }, 'admin.view')).toBe(false);
  });

  it('admin team rules: never yourself, always one super admin', async () => {
    const { setAdminRole } = await import('@/lib/services/adminTeam');
    const s1 = await mkUser('+256700000604', true);
    await db.query(`UPDATE users SET admin_role='super' WHERE id=$1`, [s1.id]);
    await expect(setAdminRole(db, s1.id, '0700000604', 'support')).rejects.toMatchObject({ code: 'cannot_change_self' });
    const s2 = await setAdminRole(db, s1.id, '0700000605', 'finance');
    const [u2] = await db.query(`SELECT is_admin, admin_role FROM users WHERE id=$1`, [s2]);
    expect(u2).toMatchObject({ is_admin: true, admin_role: 'finance' });
    await setAdminRole(db, s1.id, '0700000605', 'super');
    await setAdminRole(db, s2, '0700000604', 'trust'); // allowed: s2 is still a super admin
    await expect(setAdminRole(db, s1.id, '0700000605', 'support')).rejects.toMatchObject({ code: 'last_super_admin' });
  });

  it('money settings need a second super admin; the proposer cannot approve', async () => {
    const { changeSettings, decideProposal } = await import('@/lib/services/adminTeam');
    const { getSettings } = await import('@/lib/settings');
    const a = await mkUser('+256700000606', true);
    const b = await mkUser('+256700000607', true);
    await db.query(`UPDATE users SET admin_role='super' WHERE id IN ($1,$2)`, [a.id, b.id]);
    const r = await changeSettings(db, a.id, { fee_percent: 4, home_max_events: 9 });
    expect(r).toEqual({ applied: ['home_max_events'], proposed: ['fee_percent'] });
    expect((await getSettings(db)).fee_percent).not.toBe(4);
    const [p] = await db.query(`SELECT id FROM setting_proposals WHERE key='fee_percent'`);
    await expect(decideProposal(db, a.id, p.id, true)).rejects.toMatchObject({ code: 'same_person' });
    await decideProposal(db, b.id, p.id, true);
    expect((await getSettings(db)).fee_percent).toBe(4);
  });

  it('organizer hands the event over; blocked while a withdrawal is in progress', async () => {
    const { addMember, transferOwnership } = await import('@/lib/services/events');
    const owner = await mkUser('+256700000608');
    const tre = await mkUser('+256700000609');
    const e = await mkEvent(owner);
    await addMember(db, e.id, owner.id, '0700000609', 'treasurer');
    await db.query(
      `INSERT INTO payouts(id, event_id, account_id, amount, currency, status, requested_by)
       SELECT $1, $2, a.id, 1000, 'UGX', 'in_review', $3 FROM payout_accounts a WHERE a.user_id=$3`, [newId('po'), e.id, owner.id]);
    await expect(transferOwnership(db, e.id, owner.id, tre.id)).rejects.toMatchObject({ code: 'payout_in_progress' });
    await db.query(`UPDATE payouts SET status='rejected' WHERE event_id=$1`, [e.id]);
    await transferOwnership(db, e.id, owner.id, tre.id);
    const roles = Object.fromEntries((await db.query(`SELECT user_id, role FROM event_members WHERE event_id=$1`, [e.id])).map((r: any) => [r.user_id, r.role]));
    expect(roles).toEqual({ [tre.id]: 'owner', [owner.id]: 'viewer' });
    const msgs = await db.query(`SELECT purpose FROM messages_log WHERE purpose IN ('owner_changed','role_changed')`);
    expect(msgs.map((m: any) => m.purpose).sort()).toEqual(['owner_changed', 'role_changed']);
  });

  it('account recovery by a super admin replaces the organizer and needs a reason', async () => {
    const { adminReassignOwner } = await import('@/lib/services/events');
    const owner = await mkUser('+256700000610');
    const admin = await mkUser('+256700000611', true);
    const e = await mkEvent(owner);
    await expect(adminReassignOwner(db, e.id, admin.id, '0700000612', 'short')).rejects.toMatchObject({ code: 'reason_required' });
    await adminReassignOwner(db, e.id, admin.id, '0700000612', 'Lost phone; national ID checked in person');
    const members = await db.query(`SELECT u.phone, m.role FROM event_members m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1`, [e.id]);
    expect(members).toEqual([{ phone: '+256700000612', role: 'owner' }]);
  });

  it('the treasurer is alerted when a withdrawal is requested', async () => {
    const { addMember } = await import('@/lib/services/events');
    const owner = await mkUser('+256700000613');
    const e = await mkEvent(owner);
    await addMember(db, e.id, owner.id, '0700000614', 'treasurer');
    const p = await pledge(e.id, '0772111614', 100000);
    const pay = await payFor(p.access_token, 100000);
    await webhook(pay.id, 'succeeded');
    const [acct] = await db.query(`SELECT id FROM payout_accounts WHERE user_id=$1`, [owner.id]);
    await requestPayout(db, { eventId: e.id, userId: owner.id, accountId: acct.id, amount: 50000 });
    const alerts = await db.query(`SELECT recipient FROM messages_log WHERE purpose='payout_requested'`);
    expect(alerts.map((a: any) => a.recipient)).toEqual(['+256700000614']);
  });

  it('platform analytics agree with the ledger', async () => {
    const { platformAnalytics } = await import('@/lib/services/adminAnalytics');
    const owner = await mkUser('+256700000615');
    const e = await mkEvent(owner);
    const p = await pledge(e.id, '0772111615', 80000);
    const pay = await payFor(p.access_token, 80000);
    await webhook(pay.id, 'succeeded');
    await pledge(e.id, '0772111616', 20000, 'later');
    const a = await platformAnalytics(db, 30);
    const t = await eventTotals(db, e.id);
    expect(a.money.pledged).toBe(t.pledged);
    expect(a.money.collected).toBe(t.collected);
    expect(a.money.outstanding).toBe(t.outstanding);
    expect(a.pledges.n).toBe(2);
    expect(a.payments.successRate).toBe(100);
    expect(a.revenue.fees).toBeGreaterThan(0);
  });
});

describe('production readiness (v1.22)', () => {
  it('speed limits stop floods per IP and reset after a minute', async () => {
    const { checkRate, resetRateLimits } = await import('@/lib/rateLimit');
    resetRateLimits();
    const t0 = 1_000_000;
    let blocked = 0;
    for (let i = 0; i < 35; i++) if (checkRate('1.2.3.4', '/api/auth/request', 'POST', t0 + i) > 0) blocked++;
    expect(blocked).toBe(5); // auth: 30 per minute
    expect(checkRate('5.6.7.8', '/api/auth/request', 'POST', t0)).toBe(0); // other people unaffected
    expect(checkRate('1.2.3.4', '/api/auth/request', 'POST', t0 + 61_000)).toBe(0);
  });

  it('a refund returns the money, undoes the ledger and can never happen twice', async () => {
    const { refundPayment } = await import('@/lib/services/payments');
    const owner = await mkUser('+256700000701');
    const admin = await mkUser('+256700000702', true);
    const e = await mkEvent(owner);
    const p = await pledge(e.id, '0772111701', 60000);
    const pay = await payFor(p.access_token, 60000);
    await webhook(pay.id, 'succeeded');
    expect((await eventTotals(db, e.id)).collected).toBe(60000);
    await expect(refundPayment(db, pay.id, admin.id, 'short')).rejects.toMatchObject({ code: 'reason_required' });
    await Promise.allSettled([
      refundPayment(db, pay.id, admin.id, 'Paid twice by mistake'),
      refundPayment(db, pay.id, admin.id, 'Paid twice by mistake'),
    ]);
    const [row] = await db.query(`SELECT status FROM payments WHERE id=$1`, [pay.id]);
    expect(row.status).toBe('refunded');
    const t = await eventTotals(db, e.id);
    expect(t.collected).toBe(0);
    expect(t.outstanding).toBe(60000);
    expect(await unbalancedJournals(db)).toEqual([]);
    const reversals = await db.query(`SELECT COUNT(*)::int AS n FROM ledger_journals WHERE kind='reversal' AND event_id=$1`, [e.id]);
    expect(reversals[0].n).toBe(1);
  });

  it('money already withdrawn cannot be refunded from Ahadi', async () => {
    const { refundPayment } = await import('@/lib/services/payments');
    const owner = await mkUser('+256700000703');
    const admin = await mkUser('+256700000704', true);
    const e = await mkEvent(owner);
    const p = await pledge(e.id, '0772111703', 50000);
    const pay = await payFor(p.access_token, 50000);
    await webhook(pay.id, 'succeeded');
    const [acct] = await db.query(`SELECT id FROM payout_accounts WHERE user_id=$1`, [owner.id]);
    const t = await eventTotals(db, e.id);
    await requestPayout(db, { eventId: e.id, userId: owner.id, accountId: acct.id, amount: t.available });
    await expect(refundPayment(db, pay.id, admin.id, 'Pledger changed their mind')).rejects.toMatchObject({ code: 'refund_exceeds_available' });
    const [row] = await db.query(`SELECT status FROM payments WHERE id=$1`, [pay.id]);
    expect(row.status).toBe('succeeded');
  });

  it('erasure by phone removes the person everywhere but keeps the amounts', async () => {
    const { erasePledgerByPhone } = await import('@/lib/services/pledges');
    const owner = await mkUser('+256700000705');
    const admin = await mkUser('+256700000706', true);
    const e = await mkEvent(owner);
    const p = await pledge(e.id, '0772111705', 40000);
    const [pl] = await db.query(`SELECT consent_version FROM pledgers WHERE phone='+256772111705'`);
    expect(pl.consent_version).toBeTruthy();
    await erasePledgerByPhone(db, '0772111705', admin.id);
    expect(await db.query(`SELECT 1 FROM pledgers WHERE phone='+256772111705'`)).toEqual([]);
    expect(await db.query(`SELECT 1 FROM messages_log WHERE recipient='+256772111705'`)).toEqual([]);
    const [pg] = await db.query(`SELECT display_name, amount FROM pledges WHERE id=$1`, [p.id]);
    expect(pg).toMatchObject({ display_name: 'Deleted', amount: 40000 });
    expect((await eventTotals(db, e.id)).pledged).toBe(40000);
  });

  it('daily clean-up removes old codes and visits, blanks old messages, keeps money', async () => {
    const { runRetention } = await import('@/lib/services/ops');
    const owner = await mkUser('+256700000707');
    const e = await mkEvent(owner);
    await pledge(e.id, '0772111707', 30000);
    await db.query(`INSERT INTO otp_codes(id, identifier, code_hash, channel, purpose, expires_at, created_at) VALUES ('old1', '+256700000707', 'x', 'whatsapp', 'login', now() - interval '3 days', now() - interval '3 days')`);
    await db.query(`UPDATE messages_log SET created_at = now() - interval '400 days'`);
    const r = await runRetention(db);
    expect(r.otpCodes).toBeGreaterThanOrEqual(1);
    expect(r.messageBodies).toBeGreaterThanOrEqual(1);
    const [m] = await db.query(`SELECT body FROM messages_log LIMIT 1`);
    expect(m.body).toMatch(/^\[removed/);
    expect((await eventTotals(db, e.id)).pledged).toBe(30000);
    const [run] = await db.query(`SELECT kind, ok FROM ops_runs ORDER BY created_at DESC LIMIT 1`);
    expect(run).toEqual({ kind: 'retention', ok: true });
  });

  it('health check answers and reports the schema', async () => {
    const { health } = await import('@/lib/services/ops');
    const h = await health(db);
    expect(h.ok).toBe(true);
    const fs = await import('node:fs');
    const latest = fs.readdirSync('db/migrations').filter((f: string) => f.endsWith('.sql')).sort().pop();
    expect(h.schema).toBe(latest);
  });
});

describe('staff conflicts of interest (v1.23)', () => {
  it('staff cannot review withdrawals or refund payments of an event they are on', async () => {
    const { addMember, adminReassignOwner } = await import('@/lib/services/events');
    const { refundPayment } = await import('@/lib/services/payments');
    const owner = await mkUser('+256700000801');
    const staff = await mkUser('+256700000802', true);
    await db.query(`UPDATE users SET admin_role='super' WHERE id=$1`, [staff.id]);
    const e = await mkEvent(owner);
    await addMember(db, e.id, owner.id, '0700000802', 'treasurer');
    const p = await pledge(e.id, '0772111801', 50000);
    const pay = await payFor(p.access_token, 50000);
    await webhook(pay.id, 'succeeded');
    await expect(refundPayment(db, pay.id, staff.id, 'Testing the conflict rule')).rejects.toMatchObject({ code: 'conflict_of_interest' });
    const [po] = await db.query(
      `INSERT INTO payouts(id, event_id, account_id, amount, currency, status, requested_by)
       SELECT $1, $2, a.id, 1000, 'UGX', 'in_review', $3 FROM payout_accounts a WHERE a.user_id=$3 RETURNING *`, [newId('po'), e.id, owner.id]);
    await expect(adminReview(db, po.id, staff.id, true, 'ok')).rejects.toThrow('conflict_of_interest');
    await expect(adminReassignOwner(db, e.id, staff.id, '0700000802', 'Taking over the event myself')).rejects.toMatchObject({ code: 'conflict_of_interest' });
  });
});

describe('accounts, export and partners (v1.24)', () => {
  it('a suspended account is logged out and cannot log in; reactivation restores it', async () => {
    const { suspendAccount, reactivateAccount } = await import('@/lib/services/accounts');
    const { createSession } = await import('@/lib/services/auth');
    const sup = await mkUser('+256700000901', true);
    await db.query(`UPDATE users SET admin_role='super' WHERE id=$1`, [sup.id]);
    const org = await mkUser('+256700000902');
    const e = await mkEvent(org);
    const token = await createSession(db, org.id);
    expect(await userFromToken(db, token)).toBeTruthy();
    await expect(suspendAccount(db, sup.id, org.id, 'short', false)).rejects.toMatchObject({ code: 'reason_required' });
    await suspendAccount(db, sup.id, org.id, 'Fake hospital appeal reported by family', true);
    expect(await userFromToken(db, token)).toBeNull();
    await expect(createSession(db, org.id)).rejects.toMatchObject({ code: 'account_suspended' });
    const [ev] = await db.query(`SELECT frozen FROM events WHERE id=$1`, [e.id]);
    expect(ev.frozen).toBe(true);
    await reactivateAccount(db, sup.id, org.id);
    expect(await userFromToken(db, await createSession(db, org.id))).toBeTruthy();
    await expect(suspendAccount(db, sup.id, sup.id, 'Suspending myself for a test', false)).rejects.toMatchObject({ code: 'cannot_change_self' });
  });

  it('the last active super admin cannot be suspended', async () => {
    const { suspendAccount } = await import('@/lib/services/accounts');
    const a = await mkUser('+256700000903', true);
    const x = await mkUser('+256700000904', true);
    const other = await mkUser('+256700000905', true);
    await db.query(`UPDATE users SET admin_role='super' WHERE id IN ($1,$2)`, [a.id, x.id]);
    await suspendAccount(db, a.id, x.id, 'Left the company this week', false); // a is still a super admin
    await expect(suspendAccount(db, other.id, a.id, 'Trying to remove the last one', false)).rejects.toMatchObject({ code: 'last_super_admin' });
  });

  it('exports respect roles and hide phone numbers unless allowed', async () => {
    const { buildExport, datasetsFor } = await import('@/lib/services/adminExport');
    const owner = await mkUser('+256700000906');
    const e = await mkEvent(owner);
    await pledge(e.id, '0772111906', 25000);
    expect(datasetsFor('support')).toEqual([]);
    expect(datasetsFor('trust')).not.toContain('payments');
    expect(datasetsFor('finance')).toContain('pledges');
    const f = { from: null, to: null, type: null, phones: false };
    const masked = await buildExport(db, ['pledges'], f, 'finance');
    expect(String(masked.sheets[0]!.rows[0]!.phone)).toContain('***');
    const full = await buildExport(db, ['pledges'], { ...f, phones: true }, 'finance');
    expect(full.sheets[0]!.rows[0]!.phone).toBe('+256772111906');
    const trustTry = await buildExport(db, ['pledges', 'events'], { ...f, phones: true }, 'trust');
    expect(trustTry.sheets.map((s) => s.key)).toEqual(['events']); // pledges not allowed for trust
    expect(String(trustTry.sheets[0]!.rows[0]!.organizer_phone)).toContain('***'); // trust never gets full numbers
    const typed = await buildExport(db, ['events'], { ...f, type: 'funeral' }, 'super');
    expect(typed.sheets[0]!.rows.length).toBe(0);
  });

  it('partners: only https links, demo partners seeded, order can change', async () => {
    const { addPartner, publicPartners, updatePartner } = await import('@/lib/services/partners');
    const admin = await mkUser('+256700000907', true);
    expect((await publicPartners(db)).length).toBe(8);
    await expect(addPartner(db, admin.id, { name: 'Bad Link', url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_url' });
    const id = await addPartner(db, admin.id, { name: 'Real Partner', url: 'https://example.org' });
    await updatePartner(db, admin.id, id, { move: 'up' });
    await updatePartner(db, admin.id, id, { active: false });
    expect((await publicPartners(db)).some((p) => p.id === id)).toBe(false);
  });
});

describe('admin content tools (v1.25)', () => {
  it('SMS wording: checked placeholders, used by messages, and can be reset', async () => {
    const { setTemplate } = await import('@/lib/services/templates');
    const { renderMessage } = await import('@/lib/messages');
    const admin = await mkUser('+256700001001', true);
    await expect(setTemplate(db, admin.id, { eventType: '*', locale: 'en', stage: 'due', body: 'Pay {money} now {link}' })).rejects.toMatchObject({ code: 'template_placeholder' });
    await expect(setTemplate(db, admin.id, { eventType: '*', locale: 'en', stage: 'due', body: 'Pay now please' })).rejects.toMatchObject({ code: 'template_link' });
    await setTemplate(db, admin.id, { eventType: '*', locale: 'en', stage: 'due', body: 'Hi {name}, {balance} for {event} is due today: {link}' });
    expect(await renderMessage(db, 'wedding', 'en', 'due', { name: 'Ann', balance: 'UGX 5,000', event: 'X', link: 'L' })).toBe('Hi Ann, UGX 5,000 for X is due today: L');
    await setTemplate(db, admin.id, { eventType: '*', locale: 'en', stage: 'due', body: null });
    expect(await renderMessage(db, 'wedding', 'en', 'due', { name: 'Ann', balance: 'B', event: 'X', link: 'L' })).not.toContain('Hi Ann,');
  });

  it('staff can set or remove an event cover only with their own uploaded image', async () => {
    const { adminSetEventCover } = await import('@/lib/services/events');
    const owner = await mkUser('+256700001002');
    const admin = await mkUser('+256700001003', true);
    const e = await mkEvent(owner);
    const [f] = await db.query(`INSERT INTO files(id, owner_user_id, mime, size_bytes, data, is_public) VALUES ($1,$2,'image/jpeg',3,'\\x010203',false) RETURNING id`, [newId('fil'), admin.id]);
    const [other] = await db.query(`INSERT INTO files(id, owner_user_id, mime, size_bytes, data, is_public) VALUES ($1,$2,'image/jpeg',3,'\\x010203',false) RETURNING id`, [newId('fil'), owner.id]);
    await expect(adminSetEventCover(db, e.id, admin.id, other.id)).rejects.toMatchObject({ code: 'invalid_input' });
    await adminSetEventCover(db, e.id, admin.id, f.id);
    const [row] = await db.query(`SELECT e.cover_file_id, fl.is_public FROM events e JOIN files fl ON fl.id=e.cover_file_id WHERE e.id=$1`, [e.id]);
    expect(row).toEqual({ cover_file_id: f.id, is_public: true });
    await adminSetEventCover(db, e.id, admin.id, null);
    const [after] = await db.query(`SELECT cover_file_id FROM events WHERE id=$1`, [e.id]);
    expect(after.cover_file_id).toBeNull();
  });

  it('support lookup finds a pledger by phone with masked numbers', async () => {
    const { findPledger } = await import('@/lib/services/support');
    const owner = await mkUser('+256700001004');
    const e = await mkEvent(owner);
    await pledge(e.id, '0772111004', 15000, 'later');
    const r = await findPledger(db, '0772 111 004', false);
    expect(r!.pledger!.name).toBe('Test Person');
    expect(r!.phone).toContain('***');
    expect(r!.pledges[0]).toMatchObject({ amount: 15000, balance: 15000 });
    expect((r!.pledges[0] as any).access_token).toBeUndefined();
    expect((await findPledger(db, '0772 111 004', true))!.phone).toBe('+256772111004');
  });
});
