/**
 * WhatsApp message templates for pledger and organizer messages.
 *
 * WhatsApp only allows a business to start a conversation with a template that Meta has approved in advance.
 * These definitions are the single source of truth: `npm run wa:templates` prints them in the form you submit
 * in WhatsApp Manager, and the app fills the numbered variables in the same order when sending.
 *
 * Meta rules respected here: category "Utility"; a template may not start or end with a variable; variables
 * are separated by text. Celebratory (warm) and hospital/funeral (calm) events have separate wording.
 * Luganda is not a WhatsApp template language, so Luganda speakers receive the English template.
 */
export type WaStage = 'pledged' | 'before' | 'due' | 'after' | 'thanks' | 'milestone' | 'invite' | 'payout_requested' | 'role_changed' | 'owner_changed';
export type WaVariant = 'warm' | 'calm';
export type WaLang = 'en' | 'sw';

/** Order of the {{1}}, {{2}} … variables for each stage. */
export const WA_PARAMS: Record<WaStage, string[]> = {
  pledged: ['name', 'amount', 'event', 'link'],
  before: ['name', 'balance', 'event', 'date', 'link'],
  due: ['name', 'balance', 'event', 'link'],
  after: ['name', 'balance', 'event', 'link'],
  thanks: ['name', 'amount', 'event', 'link'],
  milestone: ['event', 'percent', 'link'],
  invite: ['event', 'link'],
  payout_requested: ['amount', 'event', 'link'],
  role_changed: ['event', 'role', 'link'],
  owner_changed: ['event', 'link'],
};

/** Stages whose wording is the same for every event tone. */
const TONELESS: WaStage[] = ['milestone', 'invite', 'payout_requested', 'role_changed', 'owner_changed'];

type Bodies = Record<WaLang, Record<WaVariant, Record<WaStage, string>>>;

// Bodies use {name}-style placeholders; they are numbered {{1}}… when submitted and sent.
export const WA_BODIES: Bodies = {
  en: {
    warm: {
      pledged: 'Thank you {name}! Your pledge of {amount} to {event} is recorded. Pay or view it here: {link} We appreciate you.',
      before: 'Hello {name}, a friendly reminder that your pledge of {balance} to {event} is due on {date}. Pay here: {link} Thank you!',
      due: 'Hello {name}, today is the day for your pledge of {balance} to {event}. Pay here: {link} Thank you for your support!',
      after: 'Hello {name}, we are still counting on your pledge of {balance} to {event}. Pay when you can: {link} Thank you!',
      thanks: 'Thank you {name}! We received {amount} for {event}. Your receipt: {link} With gratitude, Ahadi.',
      milestone: 'Good news: {event} has reached {percent}% of its target. See your dashboard: {link} Ahadi.',
      invite: 'You have been added to the committee of {event} on Ahadi. Log in with this phone number: {link} Welcome!',
      payout_requested: 'A withdrawal of {amount} was requested for {event} on Ahadi. Please review it: {link} Thank you.',
      role_changed: 'Your role on the committee of {event} on Ahadi is now: {role}. Details: {link} Thank you.',
      owner_changed: 'You are now the organizer of {event} on Ahadi. Open your dashboard: {link} Thank you.',
    },
    calm: {
      pledged: 'Thank you {name}. Your support of {amount} for {event} is recorded. View or pay here: {link} With gratitude.',
      before: 'Dear {name}, a gentle reminder of your support of {balance} for {event}, due on {date}. Pay here: {link} With gratitude.',
      due: 'Dear {name}, your support of {balance} for {event} is due today. Pay here: {link} With gratitude.',
      after: 'Dear {name}, the family is grateful for your support of {balance} for {event} whenever you are able. Pay here: {link} With gratitude.',
      thanks: 'Thank you {name}. We received {amount} for {event}. Your receipt: {link} With gratitude, Ahadi.',
      milestone: 'Good news: {event} has reached {percent}% of its target. See your dashboard: {link} Ahadi.',
      invite: 'You have been added to the committee of {event} on Ahadi. Log in with this phone number: {link} Welcome!',
      payout_requested: 'A withdrawal of {amount} was requested for {event} on Ahadi. Please review it: {link} Thank you.',
      role_changed: 'Your role on the committee of {event} on Ahadi is now: {role}. Details: {link} Thank you.',
      owner_changed: 'You are now the organizer of {event} on Ahadi. Open your dashboard: {link} Thank you.',
    },
  },
  sw: {
    warm: {
      pledged: 'Asante {name}! Ahadi yako ya {amount} kwa {event} imerekodiwa. Lipa au tazama hapa: {link} Tunakushukuru.',
      before: 'Habari {name}, ukumbusho: ahadi yako ya {balance} kwa {event} inatakiwa tarehe {date}. Lipa hapa: {link} Asante!',
      due: 'Habari {name}, leo ndiyo siku ya ahadi yako ya {balance} kwa {event}. Lipa hapa: {link} Asante kwa msaada wako!',
      after: 'Habari {name}, bado tunategemea ahadi yako ya {balance} kwa {event}. Lipa utakapoweza: {link} Asante!',
      thanks: 'Asante {name}! Tumepokea {amount} kwa {event}. Risiti yako: {link} Kwa shukrani, Ahadi.',
      milestone: 'Habari njema: {event} imefikia {percent}% ya lengo. Tazama dashibodi: {link} Ahadi.',
      invite: 'Umeongezwa kwenye kamati ya {event} kwenye Ahadi. Ingia kwa namba hii ya simu: {link} Karibu!',
      payout_requested: 'Ombi la kutoa {amount} limefanywa kwa {event} kwenye Ahadi. Tafadhali likague: {link} Asante.',
      role_changed: 'Nafasi yako kwenye kamati ya {event} kwenye Ahadi sasa ni: {role}. Maelezo: {link} Asante.',
      owner_changed: 'Sasa wewe ndiye mwandaaji wa {event} kwenye Ahadi. Fungua dashibodi yako: {link} Asante.',
    },
    calm: {
      pledged: 'Asante {name}. Mchango wako wa {amount} kwa {event} umerekodiwa. Tazama au lipa hapa: {link} Kwa shukrani.',
      before: 'Mpendwa {name}, ukumbusho wa upole wa mchango wako wa {balance} kwa {event}, tarehe {date}. Lipa hapa: {link} Kwa shukrani.',
      due: 'Mpendwa {name}, mchango wako wa {balance} kwa {event} unatakiwa leo. Lipa hapa: {link} Kwa shukrani.',
      after: 'Mpendwa {name}, familia inashukuru mchango wako wa {balance} kwa {event} utakapoweza. Lipa hapa: {link} Kwa shukrani.',
      thanks: 'Asante {name}. Tumepokea {amount} kwa {event}. Risiti yako: {link} Kwa shukrani, Ahadi.',
      milestone: 'Habari njema: {event} imefikia {percent}% ya lengo. Tazama dashibodi: {link} Ahadi.',
      invite: 'Umeongezwa kwenye kamati ya {event} kwenye Ahadi. Ingia kwa namba hii ya simu: {link} Karibu!',
      payout_requested: 'Ombi la kutoa {amount} limefanywa kwa {event} kwenye Ahadi. Tafadhali likague: {link} Asante.',
      role_changed: 'Nafasi yako kwenye kamati ya {event} kwenye Ahadi sasa ni: {role}. Maelezo: {link} Asante.',
      owner_changed: 'Sasa wewe ndiye mwandaaji wa {event} kwenye Ahadi. Fungua dashibodi yako: {link} Asante.',
    },
  },
};

export const waLang = (locale: string): WaLang => (locale === 'sw' ? 'sw' : 'en');

/** Template name in WhatsApp Manager, e.g. ahadi_before_warm, ahadi_milestone. */
export function waTemplateName(stage: WaStage, variant: WaVariant): string {
  const prefix = process.env.WHATSAPP_TEMPLATE_PREFIX || 'ahadi_';
  return TONELESS.includes(stage) ? `${prefix}${stage}` : `${prefix}${stage}_${variant}`;
}

/** The body as submitted to Meta: {name} → {{1}} in parameter order. */
export function waNumberedBody(lang: WaLang, variant: WaVariant, stage: WaStage): string {
  const order = WA_PARAMS[stage];
  return WA_BODIES[lang][variant][stage].replace(/\{(\w+)\}/g, (_, k) => `{{${order.indexOf(k) + 1}}}`);
}

/** Every template the app may send (deduplicated for tone-less stages). */
export function allWaTemplates() {
  const out: { name: string; lang: WaLang; stage: WaStage; variant: WaVariant; body: string; example: string[] }[] = [];
  const seen = new Set<string>();
  const sample: Record<string, string> = {
    name: 'Peter', amount: 'UGX 50,000', balance: 'UGX 200,000', event: "Sarah & John's Wedding", date: '12 Dec 2026',
    link: 'https://ahadi.app/p/abc123', percent: '50', role: 'Treasurer',
  };
  for (const lang of ['en', 'sw'] as WaLang[]) {
    for (const variant of ['warm', 'calm'] as WaVariant[]) {
      for (const stage of Object.keys(WA_PARAMS) as WaStage[]) {
        const name = waTemplateName(stage, variant);
        if (seen.has(`${name}:${lang}`)) continue;
        seen.add(`${name}:${lang}`);
        out.push({ name, lang, stage, variant, body: waNumberedBody(lang, variant, stage), example: WA_PARAMS[stage].map((k) => sample[k]) });
      }
    }
  }
  return out;
}
