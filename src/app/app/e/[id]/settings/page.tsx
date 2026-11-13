import { getDb } from '@/lib/db';
import { eventForUser, homeStatus } from '@/lib/services/events';
import { hasEventPass } from '@/lib/services/pledges';
import { getSettings } from '@/lib/settings';
import { requireUser } from '@/lib/web';
import { formatMoney } from '@/lib/money';
import { EVENT_TYPES, isSombre, type EventType } from '@/lib/eventTypes';
import { SettingsForm } from './SettingsForm';

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e } = await eventForUser(db, params.id, user, 'owner');
  const s = await getSettings(db);
  const [{ bal }] = await db.query<{ bal: number }>(`SELECT COALESCE(SUM(delta),0)::int AS bal FROM credits WHERE user_id=$1`, [user.id]);
  const verifications = await db.query(`SELECT kind, status FROM verifications WHERE event_id=$1 ORDER BY created_at DESC`, [e.id]);
  const tpl = EVENT_TYPES[e.type as EventType];
  return (
    <SettingsForm
      eventId={e.id}
      initial={{ privacy: e.privacy, offsets: (e.reminder_offsets as number[]).join(', '), status: e.status, tipsEnabled: e.tips_enabled, showOnHome: e.show_on_home, organizerKind: e.organizer_kind }}
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
  );
}
