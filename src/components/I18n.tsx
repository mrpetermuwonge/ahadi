'use client';
import { createContext, useContext, useMemo } from 'react';
import { DICTS, makeT, type Locale, type T } from '@/i18n';

const Ctx = createContext<{ t: T; locale: Locale }>({ t: makeT('en'), locale: 'en' });

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ t: makeT(DICTS[locale] ? locale : 'en'), locale }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
