import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { eventAccess } from '@/lib/services/events';
import { parsePledgeList, recordPledges } from '@/lib/services/committeePledges';
import { api, apiUser, jsonError } from '@/lib/web';

/**
 * Upload a list of pledges made at a meeting (Excel .xlsx or CSV: Name, Phone, Amount, optional Due date).
 * ?preview=1 only reads and checks the file; without it the pledges are recorded and each person is notified.
 */
export const POST = api(async (req, { params }: { params: { id: string } }) => {
  const user = await apiUser();
  const db = await getDb();
  const { event } = await eventAccess(db, params.id, user, 'pledges.record');
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('invalid_file');
  if (file.size > 2 * 1024 * 1024) return jsonError('file_too_large');
  if (!/\.(xlsx|csv)$/i.test(file.name)) return jsonError('invalid_file');
  const { rows, errors } = await parsePledgeList(new Uint8Array(await file.arrayBuffer()), file.name);
  if (new URL(req.url).searchParams.get('preview') === '1') {
    return NextResponse.json({ rows: rows.slice(0, 500), errors, total: rows.reduce((s, r) => s + r.amount, 0) });
  }
  if (rows.length === 0) return jsonError('invalid_file');
  const r = await recordPledges(db, event.id, user.id, rows, 'import');
  return NextResponse.json({ ...r, errors: [...errors, ...r.errors] });
});
