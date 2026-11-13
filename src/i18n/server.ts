import { cookies } from 'next/headers';
import { isLocale, makeT, type Locale } from './index';

export function getLocale(): Locale {
  const l = cookies().get('lang')?.value;
  return isLocale(l) ? l : 'en';
}

export function getT() {
  const locale = getLocale();
  return { t: makeT(locale), locale };
}
