/**
 * Country configuration. Adding Kenya, Tanzania or Rwanda is a matter of enabling an entry here
 * (and turning on a payment provider that supports it), not a rewrite.
 */
export type CountryCode = 'UG' | 'KE' | 'TZ' | 'RW';

export interface CountryConfig {
  code: CountryCode;
  currency: string;
  minorUnits: number; // decimals in the currency (0 for UGX)
  dialCode: string;
  nationalLength: number; // digits after the dial code
  mobilePrefixes: string[];
  timezone: string;
  quickAmounts: number[];
  enabled: boolean;
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  UG: {
    code: 'UG',
    currency: 'UGX',
    minorUnits: 0,
    dialCode: '256',
    nationalLength: 9,
    mobilePrefixes: ['7'], // every 07xx number (MTN, Airtel, Lyca, UTL and new ranges such as 073x)
    timezone: 'Africa/Kampala',
    quickAmounts: [20000, 50000, 100000],
    enabled: true,
  },
  KE: {
    code: 'KE',
    currency: 'KES',
    minorUnits: 0,
    dialCode: '254',
    nationalLength: 9,
    mobilePrefixes: ['7', '1'],
    timezone: 'Africa/Nairobi',
    quickAmounts: [500, 1000, 2000],
    enabled: false,
  },
  TZ: {
    code: 'TZ',
    currency: 'TZS',
    minorUnits: 0,
    dialCode: '255',
    nationalLength: 9,
    mobilePrefixes: ['6', '7'],
    timezone: 'Africa/Dar_es_Salaam',
    quickAmounts: [10000, 20000, 50000],
    enabled: false,
  },
  RW: {
    code: 'RW',
    currency: 'RWF',
    minorUnits: 0,
    dialCode: '250',
    nationalLength: 9,
    mobilePrefixes: ['72', '73', '78', '79'],
    timezone: 'Africa/Kigali',
    quickAmounts: [5000, 10000, 20000],
    enabled: false,
  },
};

export const DEFAULT_COUNTRY: CountryCode = 'UG';
export const countryForCurrency = (cur: string) =>
  Object.values(COUNTRIES).find((c) => c.currency === cur) ?? COUNTRIES.UG;
