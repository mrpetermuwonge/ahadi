/**
 * Demo data: a wedding, a hospital bill and a funeral, with pledges, mobile money payments (through the
 * mock gateway and real webhook code path), a cash entry and a reminder schedule.
 * Run with the dev server stopped:  npm run db:seed
 */
import { getDb } from '../src/lib/db';
import { newId } from '../src/lib/ids';
import { normalizePhone } from '../src/lib/phone';
import { createEvent, addMember } from '../src/lib/services/events';
import { createPledge, recordManualPayment } from '../src/lib/services/pledges';
import { startPledgePayment, processWebhook } from '../src/lib/services/payments';
import { signedMockWebhook } from '../src/lib/payments/mock';
import { addDays, localDate } from '../src/lib/time';

async function user(db: Awaited<ReturnType<typeof getDb>>, phone: string, name: string, admin = false) {
  const p = normalizePhone(phone)!;
  const [u] = await db.query(
    `INSERT INTO users(id, phone, name, is_admin, admin_role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name RETURNING *`,
    [newId('usr'), p, name, admin, admin ? 'super' : null],
  );
  await db.query(
    `INSERT INTO payout_accounts(id, user_id, kind, label, phone, verified) SELECT $1,$2,'mobile_money','My mobile money',$3,true
      WHERE NOT EXISTS (SELECT 1 FROM payout_accounts WHERE user_id=$2)`,
    [newId('pa'), u.id, p],
  );
  return u;
}

async function pay(db: Awaited<ReturnType<typeof getDb>>, token: string, amount: number, phone: string, coverFee = true) {
  const p = await startPledgePayment(db, { pledgeToken: token, amount, method: 'mtn', phone: normalizePhone(phone), coverFee, tip: 0, idempotencyKey: `seed:${newId('k')}` });
  const [tx] = await db.query(`SELECT * FROM mock_transactions WHERE reference=$1`, [p.id]);
  await db.query(`UPDATE mock_transactions SET status='succeeded' WHERE ref=$1`, [tx.ref]);
  const { body, headers } = signedMockWebhook({ id: `${tx.ref}:succeeded`, kind: 'collection', reference: p.id, ref: tx.ref, status: 'succeeded', amount: Number(tx.amount), currency: tx.currency });
  await processWebhook(db, 'mock', body, headers);
}

async function main() {
  const db = await getDb();
  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM events');
  if (n > 0) {
    console.log('Database already has events; skipping seed. Run `npm run db:reset` first for a clean demo.');
    return;
  }
  const today = localDate();
  const admin = await user(db, '0700000001', 'Ahadi Admin', true);
  const sarah = await user(db, '0772100200', 'Sarah Nakato');
  const grace = await user(db, '0752300400', 'Grace Atim');
  const joseph = await user(db, '0782500600', 'Joseph Okello');
  void admin;

  // Wedding
  const wedding = await createEvent(db, sarah.id, {
    type: 'wedding', title: 'Sarah & John’s Wedding', eventDate: addDays(today, 45), targetAmount: 15_000_000,
    story: 'We are getting married! Thank you for standing with us as we prepare for our Kwanjula and wedding day.',
    coverFileId: null, details: { couple: 'Sarah Nakato & John Ssempa', venue: 'Kampala Serena', ceremony: 'Kwanjula + Wedding' }, urgent: false,
    organizerKind: 'individual', showOnHome: true,
  });
  await addMember(db, wedding.id, sarah.id, '0701234567', 'treasurer');
  const wPledgers: [string, string, number, 'now' | 'part' | 'later'][] = [
    ['Peter Mugisha', '0772111222', 500_000, 'now'],
    ['Aisha Nambi', '0751222333', 300_000, 'part'],
    ['David Kato', '0782333444', 1_000_000, 'later'],
    ['Esther Akello', '0703444555', 200_000, 'later'],
    ['Brian Tumusiime', '0774555666', 250_000, 'now'],
  ];
  for (const [name, phone, amount, plan] of wPledgers) {
    const r = await createPledge(db, { eventId: wedding.id, name, phone, amount, message: plan === 'now' ? 'Congratulations, may God bless your home!' : null, anonymous: false, payPlan: plan, dueDate: plan === 'now' ? null : addDays(today, 30), consent: true });
    const token = r.pledge.access_token;
    if (plan === 'now') await pay(db, token, amount, phone);
    if (plan === 'part') await pay(db, token, 100_000, phone, false);
  }
  const [esther] = await db.query(`SELECT p.id FROM pledges p WHERE p.event_id=$1 AND display_name='Esther Akello'`, [wedding.id]);
  await recordManualPayment(db, { pledgeId: esther.id, amount: 50_000, reason: 'Cash at committee meeting', receiptRef: 'CM-014', actor: sarah.id });

  // Hospital bill
  const hospital = await createEvent(db, grace.id, {
    type: 'hospital', title: 'Help Baba Okot with surgery costs', eventDate: addDays(today, 10), targetAmount: 8_000_000,
    story: 'Our father needs heart surgery at Mulago. Any support helps the family meet the hospital bill.',
    coverFileId: null, details: { hospital: 'Mulago National Referral Hospital' }, urgent: true,
    organizerKind: 'individual', showOnHome: true,
  });
  await addMember(db, hospital.id, grace.id, '0779876543', 'treasurer');
  for (const [name, phone, amount] of [['Ruth Achieng', '0776000111', 400_000], ['Moses Byaruhanga', '0756000222', 150_000], ['Anonymous friend', '0786000333', 1_000_000]] as const) {
    const r = await createPledge(db, { eventId: hospital.id, name, phone, amount, message: null, anonymous: name === 'Anonymous friend', payPlan: 'now', dueDate: null, consent: true });
    await pay(db, r.pledge.access_token, amount, phone);
  }

  // Funeral
  const funeral = await createEvent(db, joseph.id, {
    type: 'funeral', title: 'In memory of Mzee Okello Jakayo', eventDate: addDays(today, 4), targetAmount: 5_000_000,
    story: 'The family invites friends to support the burial arrangements in Gulu.',
    coverFileId: null, details: { deceased: 'Mzee Okello Jakayo', burialPlace: 'Gulu, Saturday', familyContact: 'Joseph 0782 500 600' }, urgent: true,
    organizerKind: 'group', showOnHome: true,
  });
  for (const [name, phone, amount, plan] of [['Lucy Lamwaka', '0777000444', 100_000, 'now'], ['Simon Opio', '0757000555', 300_000, 'later']] as const) {
    const r = await createPledge(db, { eventId: funeral.id, name, phone, amount, message: plan === 'now' ? 'Rest in peace, Mzee.' : null, anonymous: false, payPlan: plan, dueDate: plan === 'now' ? null : addDays(today, 3), consent: true });
    if (plan === 'now') await pay(db, r.pledge.access_token, amount, phone);
  }

  // More organizer kinds for the homepage tabs (churches & nonprofits, companies & schools).
  const more: [string, string, string, 'community' | 'hospital' | 'birthday', 'faith' | 'nonprofit' | 'company' | 'school', number, [string, string, number][]][] = [
    ['0701100100', 'Rev. Daniel Mukasa', "St. Peter's Church roof appeal", 'community', 'faith', 40_000_000,
      [['Paul Kizito', '0772900001', 2_000_000], ['Ruth Namuli', '0752900002', 1_000_000], ['Choir members', '0782900003', 3_500_000]]],
    ['0701200200', 'Clean Water Uganda', 'Boreholes for Kasese schools', 'community', 'nonprofit', 25_000_000,
      [['Mary Atuhaire', '0772900004', 500_000], ['Kasese Diaspora', '0752900005', 6_000_000]]],
    ['0701300300', 'Bright Ltd HR', "Staff support for Mama Rose's surgery", 'hospital', 'company', 6_000_000,
      [['Finance team', '0772900006', 900_000], ['Sales team', '0752900007', 1_200_000]]],
    ['0701400400', 'Kings College Budo PTA', 'Senior Six graduation dinner', 'birthday', 'school', 10_000_000,
      [['Parent rep', '0782900008', 2_500_000]]],
  ];
  for (const [phone, name, title, type, kind, target, gifts] of more) {
    const owner = await user(db, phone, name);
    const ev = await createEvent(db, owner.id, {
      type, title, eventDate: addDays(today, 30), targetAmount: target, story: `${title}. Thank you for your support!`,
      coverFileId: null, details: {}, urgent: false, organizerKind: kind, showOnHome: true,
    });
    for (const [gname, gphone, amount] of gifts) {
      const r = await createPledge(db, { eventId: ev.id, name: gname, phone: gphone, amount, message: null, anonymous: false, payPlan: 'now', dueDate: null, consent: true });
      await pay(db, r.pledge.access_token, amount, gphone);
    }
  }
  // Demo only: approve the homepage requests (in real use an admin does this in Admin → Events).
  await db.query(`UPDATE events SET home_approved=true WHERE show_on_home`);

  console.log('Seeded demo events:');
  console.log(`  Wedding  /e/${wedding.slug}   (organizer 0772 100 200)`);
  console.log(`  Hospital /e/${hospital.slug}  (organizer 0752 300 400)`);
  console.log(`  Funeral  /e/${funeral.slug}   (organizer 0782 500 600)`);
  console.log('  Admin login: 0700 000 001 (set ADMIN_PHONES)');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
