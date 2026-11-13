import type { Db } from './db';
import { newId } from './ids';

/** Pluggable SMS sending. Swap providers through SMS_PROVIDER without touching callers. */
export interface SMSProvider {
  name: string;
  send(to: string, body: string): Promise<{ ok: boolean; ref?: string; error?: string }>;
}

/** Development provider: prints the SMS to the server log. Nothing leaves the machine. */
const consoleProvider: SMSProvider = {
  name: 'console',
  async send(to, body) {
    console.log(`[sms] to ${to}: ${body}`);
    return { ok: true, ref: 'console' };
  },
};

/**
 * Africa's Talking bulk SMS. Based on their public messaging API (POST /version1/messaging,
 * form fields username/to/message/from, apiKey header). Confirm against current docs before go-live.
 */
const africasTalking: SMSProvider = {
  name: 'africastalking',
  async send(to, body) {
    const username = process.env.AT_USERNAME;
    const apiKey = process.env.AT_API_KEY;
    if (!username || !apiKey) return { ok: false, error: 'AT_USERNAME / AT_API_KEY not set' };
    const base = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
    const form = new URLSearchParams({ username, to, message: body });
    if (process.env.AT_SENDER_ID) form.set('from', process.env.AT_SENDER_ID);
    try {
      const res = await fetch(`${base}/version1/messaging`, {
        method: 'POST',
        headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const json: any = await res.json().catch(() => ({}));
      const r = json?.SMSMessageData?.Recipients?.[0];
      if (!res.ok || !r || r.status !== 'Success') return { ok: false, error: JSON.stringify(json).slice(0, 300) };
      return { ok: true, ref: r.messageId };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
};

export function smsProvider(): SMSProvider {
  return process.env.SMS_PROVIDER === 'africastalking' ? africasTalking : consoleProvider;
}

/** Send and log every message. Never throws: messaging must not break a money flow. */
export async function sendSms(db: Db, to: string, body: string, purpose: string, eventId?: string | null) {
  const p = smsProvider();
  const r = await p.send(to, body);
  await db.query(
    `INSERT INTO messages_log(id, channel, recipient, body, purpose, event_id, status, provider_ref, error)
     VALUES ($1,'sms',$2,$3,$4,$5,$6,$7,$8)`,
    // Login codes are never stored in the log.
    [newId('msg'), to, purpose === 'otp' ? 'login code' : body, purpose, eventId ?? null, r.ok ? (p.name === 'console' ? 'logged' : 'sent') : 'failed', r.ref ?? null, r.error ?? null],
  );
  return r;
}

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
