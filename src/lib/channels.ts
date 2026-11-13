import type { Db } from './db';
import { newId } from './ids';

/**
 * WhatsApp and email delivery for login codes.
 * Each channel has a "console" provider for development (prints to the server log, nothing leaves the machine)
 * and one real provider chosen by environment variables.
 */

export interface SendResult {
  ok: boolean;
  ref?: string;
  error?: string;
}

async function log(db: Db, channel: string, recipient: string, body: string, purpose: string, provider: string, r: SendResult) {
  await db.query(
    `INSERT INTO messages_log(id, channel, recipient, body, purpose, status, provider_ref, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [newId('msg'), channel, recipient, body, purpose, r.ok ? (provider === 'console' ? 'logged' : 'sent') : 'failed', r.ref ?? null, r.error ?? null],
  );
}

// ---------------- WhatsApp ----------------

export const whatsappProviderName = () => (process.env.WHATSAPP_PROVIDER === 'meta' ? 'meta' : 'console');

/** WhatsApp template languages. Meta has no Luganda, so Luganda users get the English template. */
const WA_LANG: Record<string, string> = { en: 'en', sw: 'sw', lg: 'en' };

/**
 * Send an approved template with the WhatsApp Business Platform (Meta Cloud API):
 * POST https://graph.facebook.com/{version}/{phone-number-id}/messages with a Bearer token.
 * WhatsApp only allows business-initiated messages through pre-approved templates.
 * Required env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.
 */
export async function sendWhatsAppTemplate(toE164: string, name: string, langCode: string, components: unknown[]): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !name) return { ok: false, error: 'WhatsApp is not configured' };
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0';
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toE164.replace(/^\+/, ''),
        type: 'template',
        template: { name, language: { code: langCode }, components },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: JSON.stringify(json?.error ?? json).slice(0, 300) };
    return { ok: true, ref: json?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}

/** Login code: AUTHENTICATION template (WHATSAPP_OTP_TEMPLATE) with a "copy code" button. */
function sendViaMeta(toE164: string, code: string, locale: string): Promise<SendResult> {
  return sendWhatsAppTemplate(toE164, process.env.WHATSAPP_OTP_TEMPLATE ?? '', WA_LANG[locale] ?? 'en', [
    { type: 'body', parameters: [{ type: 'text', text: code }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
  ]);
}

export async function sendWhatsAppCode(db: Db, toE164: string, code: string, locale: string, purpose: string): Promise<SendResult> {
  const provider = whatsappProviderName();
  let r: SendResult;
  if (provider === 'meta') r = await sendViaMeta(toE164, code, locale);
  else {
    console.log(`[whatsapp] to ${toE164}: your Ahadi code is ${code}`);
    r = { ok: true, ref: 'console' };
  }
  // Never store the code itself in the log.
  await log(db, 'whatsapp', toE164, 'login code (template)', purpose, provider, r);
  return r;
}

// ---------------- Email ----------------

export const emailProviderName = () => (process.env.EMAIL_PROVIDER === 'resend' ? 'resend' : 'console');

/**
 * Email via Resend (https://resend.com): POST /emails with a Bearer API key.
 * Required env: RESEND_API_KEY, EMAIL_FROM (e.g. "Ahadi <login@yourdomain.com>", on a domain verified in Resend).
 */
async function sendViaResend(to: string, subject: string, text: string, html: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, error: 'Email is not configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: JSON.stringify(json).slice(0, 300) };
    return { ok: true, ref: json?.id };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 300) };
  }
}

export async function sendEmail(db: Db, to: string, subject: string, text: string, html: string, purpose: string): Promise<SendResult> {
  const provider = emailProviderName();
  let r: SendResult;
  if (provider === 'resend') r = await sendViaResend(to, subject, text, html);
  else {
    console.log(`[email] to ${to}: ${subject} — ${text}`);
    r = { ok: true, ref: 'console' };
  }
  await log(db, 'email', to, subject, purpose, provider, r);
  return r;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Simple, readable code email (works in Gmail on a phone; no images to download). */
export function codeEmailHtml(heading: string, code: string, note: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FAF8F4;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#18211F">
<div style="max-width:440px;margin:0 auto;padding:24px">
<div style="font-size:22px;font-weight:800;color:#0D5C54">Ahadi</div>
<div style="background:#fff;border:1px solid #E4E0D8;border-radius:16px;padding:24px;margin-top:16px">
<p style="margin:0 0 12px;font-size:16px">${esc(heading)}</p>
<p style="margin:0;font-size:34px;font-weight:800;letter-spacing:8px;color:#0D5C54">${esc(code)}</p>
<p style="margin:16px 0 0;font-size:13px;color:#5C6966">${esc(note)}</p>
</div></div></body></html>`;
}
