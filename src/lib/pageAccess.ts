import { notFound, redirect } from 'next/navigation';
import type { Db } from './db';
import { EventError, eventAccess } from './services/events';
import type { Permission } from './permissions';

/**
 * Page version of eventAccess: someone on the committee who opens a page their role may not see is sent to the
 * event's home page; anyone else gets "not found" (we don't reveal that the event exists).
 */
export async function pageAccess(db: Db, eventId: string, user: { id: string; is_admin: boolean }, perm: Permission) {
  let denied = false;
  try {
    return await eventAccess(db, eventId, user, perm);
  } catch (e) {
    if (!(e instanceof EventError)) throw e;
    denied = e.code === 'forbidden' && perm !== 'event.view';
  }
  if (denied) {
    const canView = await eventAccess(db, eventId, user, 'event.view').then(() => true, () => false);
    if (canView) redirect(`/app/e/${eventId}`);
  }
  notFound();
}
