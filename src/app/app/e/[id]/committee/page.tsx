import { getDb } from '@/lib/db';
import { eventForUser } from '@/lib/services/events';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatPhone } from '@/lib/phone';
import { ActionButton } from '../ActionButton';
import { AddMember } from './AddMember';
import type { Key } from '@/i18n';

export default async function CommitteePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, role } = await eventForUser(db, params.id, user, 'viewer');
  const { t } = getT();
  const members = await db.query(
    `SELECT m.user_id, m.role, u.phone, u.email, u.name FROM event_members m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'treasurer' THEN 1 ELSE 2 END`,
    [e.id],
  );
  const isOwner = role === 'owner';
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="font-bold">{t('com.title')}</h2>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="py-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{m.name ?? (m.phone ? formatPhone(m.phone) : m.email)} {m.user_id === user.id && <span className="text-xs text-muted">({t('com.you')})</span>}</p>
                <p className="text-sm text-muted">{t(`role.${m.role}` as Key)} · {t(`role.${m.role}.d` as Key)}</p>
              </div>
              {isOwner && m.user_id !== user.id && (
                <ActionButton eventId={e.id} action="remove-member" body={{ userId: m.user_id }} label={t('com.remove')} className="btn-ghost min-h-[40px] px-3 text-sm text-bad" />
              )}
            </li>
          ))}
        </ul>
      </section>
      {isOwner && <AddMember eventId={e.id} />}
    </div>
  );
}
