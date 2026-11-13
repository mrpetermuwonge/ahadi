import { en, type Dict, type Key } from './en';
import { lg } from './lg';
import { sw } from './sw';

export const LOCALES = { en: 'English', lg: 'Luganda', sw: 'Kiswahili' } as const;
export type Locale = keyof typeof LOCALES;
export const DICTS: Record<Locale, Dict> = { en, lg, sw };
export type { Key, Dict };

export const isLocale = (l: unknown): l is Locale => typeof l === 'string' && l in LOCALES;

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): T {
  const d = DICTS[locale] ?? en;
  return (key, vars) => {
    let s = d[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
