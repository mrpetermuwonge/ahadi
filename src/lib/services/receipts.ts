import { getDb } from '../db';

export async function receiptData(no: string) {
  const db = await getDb();
  const [r] = await db.query(
    `SELECT p.receipt_no, p.pledge_credit, p.charged_amount, p.currency, p.method, p.succeeded_at, p.status,
            pg.display_name, pg.anonymous, e.title, e.type, e.slug
       FROM payments p JOIN pledges pg ON pg.id=p.pledge_id JOIN events e ON e.id=p.event_id
      WHERE p.receipt_no=$1 AND p.status IN ('succeeded','refunded')`,
    [no],
  );
  return r ?? null;
}
