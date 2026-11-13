/**
 * Event type templates: default fields, wording, tone and safeguards.
 * Wording is given as i18n keys so every language gets the right word.
 */
export type EventType = 'wedding' | 'birthday' | 'hospital' | 'funeral' | 'community' | 'other';
export type Tone = 'celebratory' | 'playful' | 'calm' | 'dignified' | 'neutral';

export interface FieldDef {
  key: string;
  labelKey: string; // i18n key
  kind: 'text' | 'date';
}

export interface EventTemplate {
  type: EventType;
  tone: Tone;
  confetti: boolean;
  noun: 'pledge' | 'contribution' | 'support'; // what we call a pledge for this type
  fields: FieldDef[];
  requiresVerification: boolean; // organizer ID + invoice / letter
  secondApproverForFirstPayout: boolean;
  urgentAllowed: boolean;
  tipsDefault: boolean;
}

export const EVENT_TYPES: Record<EventType, EventTemplate> = {
  wedding: {
    type: 'wedding',
    tone: 'celebratory',
    confetti: true,
    noun: 'pledge',
    fields: [
      { key: 'couple', labelKey: 'field.couple', kind: 'text' },
      { key: 'venue', labelKey: 'field.venue', kind: 'text' },
      { key: 'ceremony', labelKey: 'field.ceremony', kind: 'text' },
    ],
    requiresVerification: false,
    secondApproverForFirstPayout: false,
    urgentAllowed: false,
    tipsDefault: true,
  },
  birthday: {
    type: 'birthday',
    tone: 'playful',
    confetti: true,
    noun: 'contribution',
    fields: [
      { key: 'celebrant', labelKey: 'field.celebrant', kind: 'text' },
      { key: 'giftNote', labelKey: 'field.giftNote', kind: 'text' },
    ],
    requiresVerification: false,
    secondApproverForFirstPayout: false,
    urgentAllowed: false,
    tipsDefault: true,
  },
  hospital: {
    type: 'hospital',
    tone: 'calm',
    confetti: false,
    noun: 'support',
    fields: [
      { key: 'patient', labelKey: 'field.patient', kind: 'text' },
      { key: 'hospital', labelKey: 'field.hospital', kind: 'text' },
    ],
    requiresVerification: true,
    secondApproverForFirstPayout: true,
    urgentAllowed: true,
    tipsDefault: false,
  },
  funeral: {
    type: 'funeral',
    tone: 'dignified',
    confetti: false,
    noun: 'support',
    fields: [
      { key: 'deceased', labelKey: 'field.deceased', kind: 'text' },
      { key: 'burialPlace', labelKey: 'field.burialPlace', kind: 'text' },
      { key: 'familyContact', labelKey: 'field.familyContact', kind: 'text' },
    ],
    requiresVerification: true,
    secondApproverForFirstPayout: true,
    urgentAllowed: true,
    tipsDefault: false,
  },
  community: {
    type: 'community',
    tone: 'neutral',
    confetti: false,
    noun: 'contribution',
    fields: [
      { key: 'institution', labelKey: 'field.institution', kind: 'text' },
      { key: 'project', labelKey: 'field.project', kind: 'text' },
    ],
    requiresVerification: false,
    secondApproverForFirstPayout: false,
    urgentAllowed: false,
    tipsDefault: true,
  },
  other: {
    type: 'other',
    tone: 'neutral',
    confetti: false,
    noun: 'pledge',
    fields: [],
    requiresVerification: false,
    secondApproverForFirstPayout: false,
    urgentAllowed: false,
    tipsDefault: true,
  },
};

export const isSombre = (t: EventType) => t === 'hospital' || t === 'funeral';
export const toneClass = (t: EventType) => `tone-${EVENT_TYPES[t]?.tone ?? 'neutral'}`;

/**
 * Who is organising the event. Shown as a badge and used for the homepage folder tabs
 * (the "Company / Nonprofit / Individual" pattern used by Givebutter and similar platforms).
 */
export const ORGANIZER_KINDS = ['individual', 'group', 'faith', 'nonprofit', 'company', 'school'] as const;
export type OrganizerKind = (typeof ORGANIZER_KINDS)[number];

/** Homepage tabs: three audiences, each grouping two organizer kinds. */
export const HOME_TABS = [
  { id: 'people', kinds: ['individual', 'group'], color: 'sky' },
  { id: 'faith', kinds: ['faith', 'nonprofit'], color: 'rose' },
  { id: 'org', kinds: ['company', 'school'], color: 'amber' },
] as const;

/** Organizer dashboard tabs: what kind of occasion it is (plus a tab for closed events). */
export const EVENT_GROUPS: Record<'celebrations' | 'support' | 'community', EventType[]> = {
  celebrations: ['wedding', 'birthday'],
  support: ['hospital', 'funeral'],
  community: ['community', 'other'],
};
