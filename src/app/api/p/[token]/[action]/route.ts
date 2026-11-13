import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { deletePledgerData, exportPledgerData, pledgerChangeAmount } from '@/lib/services/pledges';
import { DEVICE_COOKIE, canViewPledge } from '@/lib/services/pledgerAccess';
import { api, jsonError } from '@/lib/web';

/**
 * Pledger self-service on their personal page: change amount, export or delete data.
 * Same rule as the page itself: only with a fresh code-verification for the pledge's own number.
 */
async function allowed(token: string) {
  return canViewPledge(await getDb(), cookies().get(DEVICE_COOKIE)?.value, token);
}

export const POST = api(async (req, { params }: { params: { token: string; action: string } }) => {
  const db = await getDb();
  const { token, action } = params;
  if (!(await allowed(token))) return jsonError('verify_required', 403);
  if (action === 'change') {
    const { amount } = z.object({ amount: z.number().int().positive().max(1e12) }).parse(await req.json());
    return NextResponse.json(await pledgerChangeAmount(db, token, amount));
  }
  if (action === 'delete') {
    await deletePledgerData(db, token);
    return NextResponse.json({ ok: true });
  }
  return jsonError('not_found', 404);
});

export const GET = api(async (_req, { params }: { params: { token: string; action: string } }) => {
  if (params.action !== 'export') return jsonError('not_found', 404);
  if (!(await allowed(params.token))) return jsonError('verify_required', 403);
  const data = await exportPledgerData(await getDb(), params.token);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-ahadi-data.json"' },
  });
});
