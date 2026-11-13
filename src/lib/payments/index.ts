import { dpoProvider } from './dpo';
import { mockProvider } from './mock';
import type { Method, PaymentProvider } from './types';
import { zengaPayProvider } from './zengapay';

const ALL: Record<string, PaymentProvider> = {
  mock: mockProvider,
  zengapay: zengaPayProvider,
  dpo: dpoProvider,
};

// Preferred order per method: ZengaPay first for mobile money, DPO first for cards (see build brief Part 4).
const PREFERENCE: Record<Method, string[]> = {
  mtn: ['zengapay', 'dpo', 'mock'],
  airtel: ['zengapay', 'dpo', 'mock'],
  card: ['dpo', 'mock'],
};

/** Providers marked down by the admin or by repeated failures are skipped (simple in-memory circuit breaker). */
const g = globalThis as unknown as { __ahadiDown?: Map<string, number> };
const down = (g.__ahadiDown ??= new Map());
export function markProviderDown(name: string, minutes = 5) {
  down.set(name, Date.now() + minutes * 60000);
}

function enabledNames(): string[] {
  return (process.env.PAYMENT_PROVIDERS || 'mock').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Ordered candidates for a method and country: preference order, enabled, configured, not marked down. */
export function providersFor(method: Method, country: string): PaymentProvider[] {
  const enabled = new Set(enabledNames());
  return PREFERENCE[method]
    .filter((n) => enabled.has(n))
    .map((n) => ALL[n])
    .filter((p) => p && p.isConfigured() && p.supports(method, country) && (down.get(p.name) ?? 0) < Date.now());
}

export function providerByName(name: string): PaymentProvider {
  const p = ALL[name];
  if (!p) throw new Error(`unknown provider ${name}`);
  return p;
}

export function enabledProviders(): PaymentProvider[] {
  return enabledNames().map((n) => ALL[n]).filter(Boolean);
}
