import { COUNTRIES, type CountryCode } from './countries';

/**
 * Normalise a phone number to E.164 for a country.
 * Uganda accepts 07xx..., +2567xx..., 2567xx..., 7xx..., with spaces or dashes.
 * Returns null when the number is not a valid mobile number for that country.
 */
export function normalizePhone(input: string, country: CountryCode = 'UG'): string | null {
  const c = COUNTRIES[country];
  // Forgive the usual typing slips: spaces, dashes, dots, brackets, slashes, the letter O for zero.
  let d = (input || '').trim().replace(/[oO]/g, '0').replace(/[\s\-().\/_,]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith(c.dialCode) && d.length > c.nationalLength) d = d.slice(c.dialCode.length);
  if (d.startsWith('0')) d = d.slice(1); // 0772… and also +256 0772…
  if (!/^\d+$/.test(d) || d.length !== c.nationalLength) return null;
  if (!c.mobilePrefixes.some((p) => d.startsWith(p))) return null;
  return `+${c.dialCode}${d}`;
}

/**
 * Tidy what someone typed into the usual 0772 123 456 form (used when they leave a phone box), so
 * "0734545678", "+256734545678" and "256 734-545-678" all become "0734 545 678". Unknown input is left as typed.
 */
export function tidyPhone(input: string, country: CountryCode = 'UG'): string {
  const n = normalizePhone(input, country);
  return n ? formatPhone(n) : input;
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
