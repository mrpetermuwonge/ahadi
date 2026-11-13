import type { Db } from './db';
import { isSombre, type EventType } from './eventTypes';
import { fillTemplate } from './sms';

/**
 * Default SMS templates. Celebratory and sombre events get different wording.
 * Admins can override any (event_type, locale, stage) through the reminder_templates table.
 * Variables: {name} {event} {amount} {balance} {date} {link} {percent}
 * Luganda and Swahili drafts should be reviewed by a native speaker before launch.
 */
type Stage = 'before' | 'due' | 'after' | 'thanks' | 'milestone' | 'invite' | 'otp' | 'pledged';
type Variant = 'warm' | 'calm';
const T: Record<string, Record<Variant, Partial<Record<Stage, string>>>> = {
  en: {
    warm: {
      pledged: 'Thank you {name}! Your pledge of {amount} to {event} is recorded. Pay or view it here: {link}',
      before: 'Hello {name}, a friendly reminder: your pledge of {balance} to {event} is due on {date}. Pay here: {link}.',
      due: 'Hello {name}, today is the day for your pledge of {balance} to {event}. Thank you for your support! {link}.',
      after: 'Hello {name}, we are still counting on your pledge of {balance} to {event}. Pay when you can: {link}.',
      thanks: 'Thank you {name}! We received {amount} for {event}. Receipt: {link}',
      milestone: 'Great news! {event} has reached {percent}% of its target. See the dashboard: {link}',
      invite: 'You have been added to the committee of {event} on Ahadi. Log in with this phone number: {link}',
    },
    calm: {
      pledged: 'Thank you {name}. Your support of {amount} for {event} is recorded. View or pay here: {link}',
      before: 'Dear {name}, a gentle reminder of your support of {balance} for {event}, due {date}. {link}.',
      due: 'Dear {name}, your support of {balance} for {event} is due today. With gratitude. {link}.',
      after: 'Dear {name}, the family is grateful for your support of {balance} for {event} whenever you are able. {link}.',
      thanks: 'Thank you {name}. We received {amount} for {event}. Receipt: {link}',
      milestone: '{event} has reached {percent}% of the amount needed. Dashboard: {link}',
      invite: 'You have been added to the committee of {event} on Ahadi. Log in with this phone number: {link}',
    },
  },
  lg: {
    warm: {
      pledged: 'Webale nnyo {name}! Obweyamo bwo bwa {amount} eri {event} buwandiikiddwa. Laba wano: {link}',
      before: 'Gyebale {name}, tukujjukiza obweyamo bwo bwa {balance} eri {event} nga {date}. Sasula wano: {link}.',
      due: 'Gyebale {name}, leero lwe lunaku lw\'obweyamo bwo bwa {balance} eri {event}. Webale! {link}',
      after: 'Gyebale {name}, tukyalindiridde obweyamo bwo bwa {balance} eri {event}. {link}.',
      thanks: 'Webale nnyo {name}! Tufunye {amount} eri {event}. Lisiiti: {link}',
      milestone: '{event} etuuse ku {percent}% ku kigendererwa. {link}',
      invite: 'Oyongeddwa ku kakiiko ka {event} ku Ahadi. Yingira n\'ennamba eno: {link}',
    },
    calm: {
      pledged: 'Webale {name}. Obuyambi bwo bwa {amount} eri {event} buwandiikiddwa. {link}',
      before: 'Ssebo/Nnyabo {name}, tukujjukiza mpola obuyambi bwo bwa {balance} eri {event} nga {date}. {link}',
      due: 'Ssebo/Nnyabo {name}, obuyambi bwo bwa {balance} eri {event} butuuse leero. Webale. {link}',
      after: 'Ssebo/Nnyabo {name}, ab\'omu maka basiima obuyambi bwo bwa {balance} eri {event}. {link}',
      thanks: 'Webale {name}. Tufunye {amount} eri {event}. Lisiiti: {link}',
      milestone: '{event} etuuse ku {percent}% ku ssente ezeetaagibwa. {link}',
      invite: 'Oyongeddwa ku kakiiko ka {event} ku Ahadi. Yingira n\'ennamba eno: {link}',
    },
  },
  sw: {
    warm: {
      pledged: 'Asante {name}! Ahadi yako ya {amount} kwa {event} imerekodiwa. Tazama hapa: {link}',
      before: 'Habari {name}, ukumbusho: ahadi yako ya {balance} kwa {event} inatakiwa {date}. Lipa hapa: {link}.',
      due: 'Habari {name}, leo ndiyo siku ya ahadi yako ya {balance} kwa {event}. Asante! {link}',
      after: 'Habari {name}, bado tunategemea ahadi yako ya {balance} kwa {event}. {link}.',
      thanks: 'Asante {name}! Tumepokea {amount} kwa {event}. Risiti: {link}',
      milestone: '{event} imefikia {percent}% ya lengo. {link}',
      invite: 'Umeongezwa kwenye kamati ya {event} kwenye Ahadi. Ingia kwa namba hii: {link}',
    },
    calm: {
      pledged: 'Asante {name}. Mchango wako wa {amount} kwa {event} umerekodiwa. {link}',
      before: 'Mpendwa {name}, ukumbusho wa upole wa mchango wako wa {balance} kwa {event}, tarehe {date}. {link}',
      due: 'Mpendwa {name}, mchango wako wa {balance} kwa {event} unatakiwa leo. Shukrani. {link}',
      after: 'Mpendwa {name}, familia inashukuru mchango wako wa {balance} kwa {event} utakapoweza. {link}',
      thanks: 'Asante {name}. Tumepokea {amount} kwa {event}. Risiti: {link}',
      milestone: '{event} imefikia {percent}% ya kiasi kinachohitajika. {link}',
      invite: 'Umeongezwa kwenye kamati ya {event} kwenye Ahadi. Ingia kwa namba hii: {link}',
    },
  },
};

export const OTP_TEMPLATE: Record<string, string> = {
  en: 'Your Ahadi code is {code}. It expires in 5 minutes. Do not share it.',
  lg: 'Koodi yo eya Ahadi ye {code}. Eggwaako mu ddakiika 5. Togiwa muntu.',
  sw: 'Nambari yako ya Ahadi ni {code}. Inaisha baada ya dakika 5. Usiishiriki.',
};

export async function renderMessage(
  db: Db,
  eventType: EventType,
  locale: string,
  stage: Stage,
  vars: Record<string, string>,
): Promise<string> {
  const loc = T[locale] ? locale : 'en';
  const rows = await db.query<{ body: string }>(
    `SELECT body FROM reminder_templates WHERE locale=$1 AND stage=$2 AND event_type IN ($3,'*')
     ORDER BY CASE WHEN event_type=$3 THEN 0 ELSE 1 END LIMIT 1`,
    [loc, stage, eventType],
  );
  const variant: Variant = isSombre(eventType) ? 'calm' : 'warm';
  const body = rows[0]?.body ?? T[loc][variant][stage] ?? T.en[variant][stage] ?? '';
  return fillTemplate(body, vars);
}
