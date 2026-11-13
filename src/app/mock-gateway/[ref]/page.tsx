import { notFound, redirect } from 'next/navigation';
import { getDb } from '@/lib/db';

/** Stand-in for a gateway's hosted card checkout (mock provider only). Ahadi never sees card numbers. */
export default async function MockGateway({ params }: { params: { ref: string } }) {
  if (!(process.env.PAYMENT_PROVIDERS || 'mock').split(',').includes('mock')) notFound();
  const db = await getDb();
  const [tx] = await db.query(`SELECT reference FROM mock_transactions WHERE ref=$1`, [params.ref]);
  if (!tx) notFound();
  // The simulator controls live on the status page so card and mobile money share one test surface.
  redirect(`/pay/${tx.reference}`);
}
