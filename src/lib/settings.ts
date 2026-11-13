import type { Db } from './db';

/**
 * Admin-editable settings. Nothing price-related is hard-coded anywhere else:
 * these are only the fallback values used before an admin saves a change.
 * They are starting suggestions to test, not market facts.
 */
export const DEFAULT_SETTINGS = {
  fee_percent: 3, // Ahadi transaction fee on each successful payment
  fee_min: 500,
  event_pass_price: 50000,
  sms_bundle_size: 100,
  sms_bundle_price: 10000,
  free_max_active_events: 1,
  free_max_pledges: 50,
  free_sms_per_event: 100,
  tips_enabled: true,
  tip_suggestions: [0, 1000, 2000],
  referral_reward_credits: 50,
  new_event_review_threshold: 5000000, // flag new events (< 72h old) collecting more than this
  velocity_max_pledges_per_phone_per_hour: 5,
  velocity_max_payments_per_phone_per_10min: 5,
  mobile_money_timeout_seconds: 60,
  whatsapp_messages_enabled: true, // pledger + organizer messages on WhatsApp (SMS fallback)
  quiet_hours_start: 21,
  quiet_hours_end: 7,
  otp_min_gap_seconds: 30, // wait between two codes to the same number
  otp_max_per_10min: 10, // codes per number per 10 minutes
  otp_max_per_day: 40, // codes per number per 24 hours
  home_requires_approval: true, // events asked for the homepage slideshow wait for an admin
  home_max_events: 12,
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as Settings;
}

export async function saveSetting(db: Db, key: SettingKey, value: unknown, userId: string) {
  const def = DEFAULT_SETTINGS[key];
  if (typeof def === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid number for ${key}`);
  }
  if (typeof def === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid boolean for ${key}`);
  await db.query(
    `INSERT INTO settings(key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
}
