import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { createRequest } from '@/lib/services/supportRequests';
import { api, currentUser } from '@/lib/web';

const Body = z.object({
  name: z.string().max(80), contact: z.string().max(120), topic: z.string().max(20),
  message: z.string().max(2000), eventRef: z.string().max(200).nullable().optional(),
  website: z.string().max(200).optional(), // hidden field: real people leave it empty (stops simple spam bots)
});

/** "Contact Ahadi": anyone can write; returns a reference number and a private link to follow the reply. */
export const POST = api(async (req) => {
  const b = Body.parse(await req.json());
  if (b.website) return NextResponse.json({ ref: 'AH-SUP-0000', token: '' });
  const user = await currentUser();
  return NextResponse.json(await createRequest(await getDb(), { ...b, userId: user?.id ?? null }));
});
