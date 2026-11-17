import { getDb } from '@/lib/db';
import { pageAccess } from '@/lib/pageAccess';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatPhone, maskPhone } from '@/lib/phone';
import { ActionButton } from '../ActionButton';
import { AddMember } from './AddMember';
import type { Key } from '@/i18n';

export default async function CommitteePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, perms } = await pageAccess(db, params.id, user, 'committee.view');
  const { t } = getT();
  const members = await db.query(
    `SELECT m.user_id, m.role, u.phone, u.email, u.name FROM event_members m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'treasurer' THEN 1 ELSE 2 END`,
    [e.id],
  );
  const isOwner = perms['committee.manage'];
  // Helpers see committee numbers masked; the organizer and treasurer see them in full.
  const showPhone = (p: string) => (perms['committee.contacts'] ? formatPhone(p) : maskPhone(p));
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="font-bold">{t('com.title')}</h2>
        <ul className="mt-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="py-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{m.name ?? (m.phone ? showPhone(m.phone) : m.email)} {m.user_id === user.id && <span className="text-xs text-muted">({t('com.you')})</span>}</p>
                <p className="text-sm text-muted">{t(`role.${m.role}` as Key)} · {t(`role.${m.role}.d` as Key)}</p>
              </div>
              {isOwner && m.user_id !== user.id && m.role !== 'owner' && (
                <span className="flex flex-wrap gap-1 justify-end">
                  {perms['committee.transfer'] && (
                    <ActionButton eventId={e.id} action="transfer-owner" body={{ userId: m.user_id }} label={t('com.makeOrganizer')}
                      confirmText={t('com.makeOrganizerConfirm', { name: m.name ?? (m.phone ? formatPhone(m.phone) : m.email) })}
                      className="btn-outline min-h-[40px] px-3 text-sm" />
                  )}
                  <ActionButton eventId={e.id} action="remove-member" body={{ userId: m.user_id }} label={t('com.remove')} className="btn-ghost min-h-[40px] px-3 text-sm text-bad" />
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
      {isOwner && <AddMember eventId={e.id} />}
    </div>
  );
}
