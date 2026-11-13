import type { Db } from './db';
import { isSombre, type EventType } from './eventTypes';
import { newId } from './ids';
import { renderMessage } from './messages';
import { getSettings } from './settings';
import { fillTemplate, sendSms } from './sms';
import { sendWhatsAppTemplate, whatsappProviderName } from './channels';
import { WA_BODIES, WA_PARAMS, waLang, waTemplateName, type WaStage } from './waTemplates';

/**
 * Pledger and organizer messages (pledge confirmation, receipts, reminders, milestones, committee invites).
 *
 * WhatsApp first, SMS as the safety net:
 *   - if the admin setting `whatsapp_messages_enabled` is on, send the approved WhatsApp template;
 *   - if WhatsApp refuses it right away, send the SMS version immediately;
 *   - if WhatsApp accepts it but later reports it failed (e.g. the number has no WhatsApp), the status
 *     webhook sends the SMS version once (see handleWhatsAppStatus).
 * Set NOTIFY_SMS_FALLBACK=false to disable the SMS safety net. Never throws.
 */
export interface Notice {
  to: string; // E.164
  stage: WaStage;
  eventType: EventType;
  locale: string;
  vars: Record<string, string>;
  purpose: string;
  eventId?: string | null;
}

const fallbackOn = () => process.env.NOTIFY_SMS_FALLBACK !== 'false';

export async function notify(db: Db, n: Notice): Promise<{ ok: boolean; channel: 'whatsapp' | 'sms' }> {
  // SMS wording (admins can override it per event type); also kept in the log for a later fallback.
  const smsText = await renderMessage(db, n.eventType, n.locale, n.stage, n.vars);
  const settings = await getSettings(db);

  if (settings.whatsapp_messages_enabled) {
    const variant = isSombre(n.eventType) ? 'calm' : 'warm';
    const lang = waLang(n.locale);
    const name = waTemplateName(n.stage, variant);
    const provider = whatsappProviderName();
    let r: { ok: boolean; ref?: string; error?: string };
    if (provider === 'meta') {
      r = await sendWhatsAppTemplate(n.to, name, lang, [
        { type: 'body', parameters: WA_PARAMS[n.stage].map((k) => ({ type: 'text', text: n.vars[k] ?? '' })) },
      ]);
    } else {
      console.log(`[whatsapp] to ${n.to} (${name}/${lang}): ${fillTemplate(WA_BODIES[lang][variant][n.stage], n.vars)}`);
      r = { ok: true, ref: 'console' };
    }
    await db.query(
      `INSERT INTO messages_log(id, channel, recipient, body, purpose, event_id, status, provider_ref, error)
       VALUES ($1,'whatsapp',$2,$3,$4,$5,$6,$7,$8)`,
      [newId('msg'), n.to, smsText, n.purpose, n.eventId ?? null, r.ok ? (provider === 'console' ? 'logged' : 'sent') : 'failed', r.ref ?? null, r.error ?? null],
    );
    if (r.ok) return { ok: true, channel: 'whatsapp' };
    if (!fallbackOn()) return { ok: false, channel: 'whatsapp' };
  }
  const s = await sendSms(db, n.to, smsText, n.purpose, n.eventId);
  return { ok: s.ok, channel: 'sms' };
}

/** A WhatsApp delivery status arrived (sent / delivered / read / failed). Failed → one SMS fallback. */
export async function handleWhatsAppStatus(db: Db, providerRef: string, status: string) {
  if (!['sent', 'delivered', 'read', 'failed'].includes(status)) return;
  const [m] = await db.query(`SELECT * FROM messages_log WHERE provider_ref=$1 AND channel='whatsapp'`, [providerRef]);
  if (!m) return;
  await db.query(`UPDATE messages_log SET delivery_status=$2 WHERE id=$1`, [m.id, status]);
  if (status !== 'failed' || !fallbackOn() || m.purpose.startsWith('otp')) return;
  // Claim the fallback first so a repeated webhook never sends two SMS.
  const claimed = await db.query(`UPDATE messages_log SET fallback_sent=true WHERE id=$1 AND fallback_sent=false RETURNING id`, [m.id]);
  if (claimed.length) await sendSms(db, m.recipient, m.body, `${m.purpose}_fallback`, m.event_id);
}
