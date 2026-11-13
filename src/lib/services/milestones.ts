import type { Db } from '../db';
import { APP_URL } from '../config';
import { eventTotals } from '../ledger';
import { renderMessage } from '../messages';
import { percent } from '../money';
import { notify } from '../notify';
import { sendEmail } from '../channels';
import type { EventType } from '../eventTypes';
import { newId } from '../ids';
import { getSettings } from '../settings';

const MILESTONES = [25, 50, 75, 100];

/** Notify the owner once at 25/50/75/100% of target. Also raises a fraud flag for new events collecting large sums. */
export async function checkMilestones(db: Db, eventId: string) {
  const [e] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!e) return;
  const t = await eventTotals(db, eventId);

  const s = await getSettings(db);
  const ageHours = (Date.now() - new Date(e.created_at).getTime()) / 3600000;
  if (ageHours < 72 && t.collected > s.new_event_review_threshold) {
    const open = await db.query(`SELECT 1 FROM reports WHERE event_id=$1 AND source='system' AND reason LIKE 'new_event_large%'`, [eventId]);
    if (open.length === 0) {
      await db.query(`INSERT INTO reports(id, event_id, source, reason) VALUES ($1,$2,'system',$3)`, [
        newId('rep'), eventId, `new_event_large: collected ${t.collected} within ${Math.round(ageHours)}h`,
      ]);
    }
  }

  if (!e.target_amount) return;
  const pct = percent(t.collected, Number(e.target_amount));
  const sent: number[] = e.milestones_sent ?? [];
  const due = MILESTONES.filter((m) => pct >= m && !sent.includes(m));
  if (due.length === 0) return;
  const top = Math.max(...due);
  // Claim the milestones atomically so concurrent payments do not double-notify.
  const claimed = await db.query(
    `UPDATE events SET milestones_sent = milestones_sent || $2::int[] WHERE id=$1 AND NOT (milestones_sent && $2::int[]) RETURNING id`,
    [eventId, due],
  );
  if (claimed.length === 0) return;
  const owners = await db.query(
    `SELECT u.phone, u.email, u.locale FROM event_members m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1 AND m.role='owner'`,
    [eventId],
  );
  for (const o of owners) {
    const vars = { event: e.title, percent: String(top), link: `${APP_URL()}/app/e/${eventId}` };
    // Owners who signed up by email / Google and have not added a phone get the notice by email.
    if (o.phone) {
      await notify(db, { to: o.phone, stage: 'milestone', eventType: e.type as EventType, locale: o.locale, purpose: 'milestone', eventId, vars });
      continue;
    }
    const body = await renderMessage(db, e.type as EventType, o.locale, 'milestone', vars);
    if (o.email) await sendEmail(db, o.email, `Ahadi: ${e.title} — ${top}%`, body, `<p>${body.replace(/[&<>]/g, '')}</p>`, 'milestone');
  }
}
