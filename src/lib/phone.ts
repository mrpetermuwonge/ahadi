import { COUNTRIES, type CountryCode } from './countries';

/**
 * Normalise a phone number to E.164 for a country.
 * Uganda accepts 07xx..., +2567xx..., 2567xx..., 7xx..., with spaces or dashes.
 * Returns null when the number is not a valid mobile number for that country.
 */
export function normalizePhone(input: string, country: CountryCode = 'UG'): string | null {
  const c = COUNTRIES[country];
  let d = (input || '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(c.dialCode)) d = d.slice(c.dialCode.length);
  else if (d.startsWith('0')) d = d.slice(1);
  if (!/^\d+$/.test(d) || d.length !== c.nationalLength) return null;
  if (!c.mobilePrefixes.some((p) => d.startsWith(p))) return null;
  return `+${c.dialCode}${d}`;
}

/** 0772 123 456 style for display */
export function formatPhone(e164: string): string {
  const m = /^\+256(\d{3})(\d{3})(\d{3})$/.exec(e164);
  if (m) return `0${m[1]} ${m[2]} ${m[3]}`;
  return e164;
}

/** Mask for public display: 0772 *** 456 */
export function maskPhone(e164: string): string {
  const f = formatPhone(e164);
  return f.replace(/^(\S+) (\S+) (\S+)$/, '$1 *** $3');
}

/** Which mobile money network a Ugandan number belongs to (used to pre-select MTN / Airtel). */
export function detectNetwork(e164: string): 'mtn' | 'airtel' | null {
  const m = /^\+256(\d{2})/.exec(e164);
  if (!m) return null;
  const p = m[1];
  if (['77', '78', '76', '79'].includes(p)) return 'mtn';
  if (['70', '75', '74'].includes(p)) return 'airtel';
  return null;
}
