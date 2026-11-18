import type { Db } from '../db';
import { audit } from '../audit';
import { newId } from '../ids';
import { EDITABLE_STAGES, PLACEHOLDERS, type Stage } from '../messages';
import { EventError } from './events';

/**
 * SMS wording overrides (used when a message falls back to SMS; WhatsApp wording is fixed by the templates Meta
 * approved). Super admins change them in Admin → Settings. event_type '*' applies to every type.
 */
const TYPES = ['*', 'wedding', 'birthday', 'hospital', 'funeral', 'community', 'other'];
const LOCALES = ['en', 'lg', 'sw'];

export const listTemplateOverrides = (db: Db) =>
  db.query(`SELECT id, event_type, locale, stage, body FROM reminder_templates ORDER BY stage, event_type, locale`);

export async function setTemplate(db: Db, actor: string, t: { eventType: string; locale: string; stage: string; body: string | null }) {
  if (!TYPES.includes(t.eventType) || !LOCALES.includes(t.locale) || !EDITABLE_STAGES.includes(t.stage as Stage)) throw new EventError('invalid_input');
  if (t.body === null || t.body.trim() === '') {
    await db.query(`DELETE FROM reminder_templates WHERE event_type=$1 AND locale=$2 AND stage=$3`, [t.eventType, t.locale, t.stage]);
    await audit(db, { actor, action: 'admin.template_reset', entityType: 'template', entityId: `${t.stage}:${t.eventType}:${t.locale}` });
    return;
  }
  const body = t.body.trim();
  if (body.length > 480) throw new EventError('template_too_long');
  const used = [...body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const unknown = used.filter((u) => !PLACEHOLDERS.includes(u));
  if (unknown.length) throw new EventError('template_placeholder');
  if (!body.includes('{link}') && !['milestone'].includes(t.stage)) throw new EventError('template_link');
  await db.query(
    `INSERT INTO reminder_templates(id, event_type, locale, stage, body) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (event_type, locale, stage) DO UPDATE SET body=EXCLUDED.body`,
    [newId('tpl'), t.eventType, t.locale, t.stage, body],
  );
  await audit(db, { actor, action: 'admin.template_set', entityType: 'template', entityId: `${t.stage}:${t.eventType}:${t.locale}`, details: { body } });
}
