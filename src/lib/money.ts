import { countryForCurrency } from './countries';

/** Format an integer amount in minor units: formatMoney(50000, 'UGX') -> "UGX 50,000" */
export function formatMoney(amount: number, currency = 'UGX'): string {
  const { minorUnits } = countryForCurrency(currency);
  const value = amount / 10 ** minorUnits;
  const s = value.toLocaleString('en-US', {
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  });
  return `${currency} ${s}`;
}

/** Parse what a user typed ("50,000", "50 000", "50000") into integer minor units, or null. */
export function parseAmount(input: string | number, currency = 'UGX'): number | null {
  const { minorUnits } = countryForCurrency(currency);
  const s = String(input).replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 10 ** minorUnits);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Ahadi fee for a payment amount. Rounded up so fractions never leak. */
export function computeFee(amount: number, percent: number, min: number): number {
  if (percent <= 0) return 0;
  return Math.max(min, Math.ceil((amount * percent) / 100));
}

export function percent(part: number, whole: number | null | undefined): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((part / whole) * 100)));
}
