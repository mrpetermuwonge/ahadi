import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { currentUser } from '@/lib/web';

/** Serve a file. Public files (cover photos) to anyone; private documents only to their owner or an admin. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const db = await getDb();
  const [f] = await db.query('SELECT * FROM files WHERE id=$1', [params.id]);
  if (!f) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!f.is_public) {
    const u = await currentUser();
    if (!u || (u.id !== f.owner_user_id && !u.is_admin)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return new NextResponse(Buffer.from(f.data), {
    headers: {
      'content-type': f.mime,
      'cache-control': f.is_public ? 'public, max-age=31536000, immutable' : 'private, no-store',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
