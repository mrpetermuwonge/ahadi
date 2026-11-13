import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { newId } from '@/lib/ids';
import { api, apiUser, jsonError } from '@/lib/web';

const MAX = 2 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Upload a cover photo or verification document (signed-in organizers only). */
export const POST = api(async (req) => {
  const user = await apiUser();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) return jsonError('invalid_input');
  if (file.size > MAX) return jsonError('file_too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes, not the browser's label: check magic numbers.
  const mime =
    bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
    : bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png'
    : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp'
    : bytes[0] === 0x25 && bytes[1] === 0x50 ? 'application/pdf'
    : null;
  if (!mime || !ALLOWED.includes(mime)) return jsonError('invalid_input');
  const id = newId('fil');
  await (await getDb()).query(
    `INSERT INTO files(id, owner_user_id, mime, size_bytes, data, is_public) VALUES ($1,$2,$3,$4,$5,false)`,
    [id, user.id, mime, bytes.length, Buffer.from(bytes)],
  );
  return NextResponse.json({ id });
});
