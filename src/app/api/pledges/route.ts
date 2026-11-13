import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { createPledge, PledgeError } from '@/lib/services/pledges';
import { DEVICE_COOKIE, devicePhone, requireVerifiedForPledge } from '@/lib/services/pledgerAccess';
import { normalizePhone } from '@/lib/phone';
import { api } from '@/lib/web';

const Body = z.object({
  eventId: z.string().max(40),
  name: z.string().max(80),
  phone: z.string().max(30),
  amount: z.number().int().positive().max(1e12),
  message: z.string().max(280).nullable().optional(),
  anonymous: z.boolean(),
  payPlan: z.enum(['now', 'part', 'later']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  consent: z.boolean(),
  locale: z.enum(['en', 'lg', 'sw']).optional(),
});

/** Public: create a pledge. No account needed. */
export const POST = api(async (req) => {
  const b = Body.parse(await req.json());
  const db = await getDb();
  // Every pledge needs a fresh one-time code for this exact number (verified in the last 15 minutes).
  const useUp = await requireVerifiedForPledge(db, cookies().get(DEVICE_COOKIE)?.value, b.phone);
  try {
    const r = await createPledge(db, { ...b, message: b.message ?? null, dueDate: b.dueDate ?? null });
    await useUp(); // one code, one pledge: the next pledge needs a new code
    return NextResponse.json({ token: r.pledge.access_token });
  } catch (e) {
    // Same number already pledged here. If THIS device has proved it owns the number, take them to
    // their existing pledge; otherwise reveal nothing (the link was sent to the phone itself).
    if (e instanceof PledgeError && e.code === 'duplicate') {
      const proved = await devicePhone(db, cookies().get(DEVICE_COOKIE)?.value);
      const phone = normalizePhone(b.phone);
      if (proved && phone && proved === phone) {
        const [p] = await db.query(
          `SELECT pg.access_token FROM pledges pg JOIN pledgers pl ON pl.id=pg.pledger_id WHERE pg.event_id=$1 AND pl.phone=$2`,
          [b.eventId, phone],
        );
        if (p) throw new PledgeError('duplicate', { token: p.access_token });
      }
    }
    throw e;
  }
});
