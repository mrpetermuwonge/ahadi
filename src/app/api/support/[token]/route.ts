import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { addRequesterMessage } from '@/lib/services/supportRequests';
import { api } from '@/lib/web';

/** The person answers on their own request (private link from the confirmation or the WhatsApp reply). */
export const POST = api(async (req, { params }: { params: { token: string } }) => {
  const { body } = z.object({ body: z.string().max(2000) }).parse(await req.json());
  await addRequesterMessage(await getDb(), params.token, body);
  return NextResponse.json({ ok: true });
});
