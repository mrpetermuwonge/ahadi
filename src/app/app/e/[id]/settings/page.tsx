import { getDb } from '@/lib/db';
import { homeStatus } from '@/lib/services/events';
import { pageAccess } from '@/lib/pageAccess';
import { hasEventPass } from '@/lib/services/pledges';
import { getSettings } from '@/lib/settings';
import { requireUser } from '@/lib/web';
import { formatMoney } from '@/lib/money';
import { EVENT_TYPES, isSombre, type EventType } from '@/lib/eventTypes';
import { SettingsForm } from './SettingsForm';
import { EventDetailsForm } from './EventDetailsForm';

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e } = await pageAccess(db, params.id, user, 'settings.manage');
  const s = await getSettings(db);
  const [{ bal }] = await db.query<{ bal: number }>(`SELECT COALESCE(SUM(delta),0)::int AS bal FROM credits WHERE user_id=$1`, [user.id]);
  const verifications = await db.query(`SELECT kind, status FROM verifications WHERE event_id=$1 ORDER BY created_at DESC`, [e.id]);
  const tpl = EVENT_TYPES[e.type as EventType];
  const [{ d: dateStr }] = await db.query<{ d: string | null }>(`SELECT to_char(event_date, 'YYYY-MM-DD') AS d FROM events WHERE id=$1`, [e.id]);
  return (
    <div className="space-y-4">
    <EventDetailsForm
      eventId={e.id}
      initial={{
        title: e.title, date: dateStr ?? '', target: e.target_amount ? String(e.target_amount) : '', story: e.story ?? '',
        coverId: e.cover_file_id ?? null, details: (e.details ?? {}) as Record<string, string>,
      }}
      fields={tpl.fields}
      currency={e.currency}
      verified={!!e.verified}
    />
    <SettingsForm
      eventId={e.id}
      initial={{ privacy: e.privacy, offsets: (e.reminder_offsets as number[]).join(', '), status: e.status, tipsEnabled: e.tips_enabled, showOnHome: e.show_on_home, organizerKind: e.organizer_kind, showAmounts: e.show_amounts !== false }}
      homeStatus={homeStatus(e, s.home_requires_approval)}
      sombre={isSombre(e.type)}
      plan={{
        hasPass: await hasEventPass(db, e.id),
        freeMax: s.free_max_pledges,
        passPrice: formatMoney(s.event_pass_price, e.currency),
        credits: bal,
        bundleSize: s.sms_bundle_size,
        bundlePrice: formatMoney(s.sms_bundle_price, e.currency),
      }}
      verification={tpl.requiresVerification ? { verified: e.verified, submitted: verifications.map((v) => ({ kind: v.kind, status: v.status })) } : null}
      phone={(user.phone ?? '').replace(/^\+256/, '0')}
    />
    </div>
  );
}
