import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { createEvent } from '@/lib/services/events';
import { api, apiUser } from '@/lib/web';

const Body = z.object({
  type: z.enum(['wedding', 'birthday', 'hospital', 'funeral', 'community', 'other']),
  title: z.string().max(100),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  targetAmount: z.number().int().positive().max(1e13).nullable(),
  story: z.string().max(4000),
  coverFileId: z.string().max(40).nullable(),
  details: z.record(z.string().max(200)),
  urgent: z.boolean(),
  organizerKind: z.enum(['individual', 'group', 'faith', 'nonprofit', 'company', 'school']).optional(),
  showOnHome: z.boolean().optional(),
});

export const POST = api(async (req) => {
  const user = await apiUser();
  const b = Body.parse(await req.json());
  const e = await createEvent(await getDb(), user.id, b);
  return NextResponse.json({ id: e.id, slug: e.slug });
});
