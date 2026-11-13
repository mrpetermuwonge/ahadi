import { describe, expect, it } from 'vitest';
import { normalizePhone, detectNetwork } from '@/lib/phone';
import { formatMoney, parseAmount, computeFee } from '@/lib/money';
import { chargedAmount, paymentLines, pledgeLines, manualPaymentLines, pledgeState } from '@/lib/ledger';
import { inQuietHours, nextAllowedTime, zonedTime } from '@/lib/time';
import { DICTS } from '@/i18n';
import { en } from '@/i18n/en';

const sum = (ls: { amount: number }[]) => ls.reduce((s, l) => s + l.amount, 0);

describe('phone numbers', () => {
  it('07xx, +2567xx and 2567xx all normalise to the same person', () => {
    const forms = ['0772 123 456', '+256772123456', '256772123456', '772123456', '0772-123-456', '00256772123456'];
    for (const f of forms) expect(normalizePhone(f)).toBe('+256772123456');
  });
  it('rejects non-mobile and wrong-length numbers', () => {
    expect(normalizePhone('0412 123 456')).toBeNull();
    expect(normalizePhone('07721234')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
  it('detects networks', () => {
    expect(detectNetwork('+256772123456')).toBe('mtn');
    expect(detectNetwork('+256752123456')).toBe('airtel');
  });
});

describe('money', () => {
  it('formats UGX with separators and no decimals', () => {
    expect(formatMoney(50000, 'UGX')).toBe('UGX 50,000');
  });
  it('parses typed amounts into integers', () => {
    expect(parseAmount('50,000')).toBe(50000);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('rounds fees up and applies the minimum', () => {
    expect(computeFee(100000, 3, 500)).toBe(3000);
    expect(computeFee(1000, 3, 500)).toBe(500);
    expect(computeFee(33333, 3, 0)).toBe(1000);
  });
});

describe('journal builders always balance', () => {
  it('pledge', () => expect(sum(pledgeLines('p', 70000))).toBe(0));
  it('manual payment', () => expect(sum(manualPaymentLines('p', 70000))).toBe(0));
  for (const feeCovered of [true, false]) {
    for (const tip of [0, 2000]) {
      it(`payment feeCovered=${feeCovered} tip=${tip}`, () => {
        const s = { pledgeCredit: 100000, fee: 3000, feeCovered, tip };
        expect(sum(paymentLines('p', s))).toBe(0);
        expect(chargedAmount(s)).toBe(100000 + tip + (feeCovered ? 3000 : 0));
      });
    }
  }
  it('refuses a fee larger than an uncovered payment', () => {
    expect(() => paymentLines('p', { pledgeCredit: 100, fee: 500, feeCovered: false, tip: 0 })).toThrow();
  });
  it('pledge state', () => {
    expect(pledgeState({ pledgeId: 'p', pledged: 10, paid: 10, balance: 0 }, null, '2026-01-01')).toBe('paid');
    expect(pledgeState({ pledgeId: 'p', pledged: 10, paid: 5, balance: 5 }, '2026-02-01', '2026-01-01')).toBe('partial');
    expect(pledgeState({ pledgeId: 'p', pledged: 10, paid: 0, balance: 10 }, '2025-12-01', '2026-01-01')).toBe('overdue');
  });
});

describe('quiet hours in Africa/Kampala', () => {
  it('21:00-07:00 local is quiet', () => {
    expect(inQuietHours(zonedTime('2026-11-12', 22), 21, 7)).toBe(true);
    expect(inQuietHours(zonedTime('2026-11-12', 6), 21, 7)).toBe(true);
    expect(inQuietHours(zonedTime('2026-11-12', 9), 21, 7)).toBe(false);
  });
  it('a reminder due at 23:00 is moved to 07:00 the next morning, local time', () => {
    const next = nextAllowedTime(zonedTime('2026-11-12', 23), 21, 7);
    expect(next.toISOString()).toBe('2026-11-13T04:00:00.000Z'); // 07:00 EAT
  });
});

describe('i18n', () => {
  it('every language has every key, with no empty strings', () => {
    for (const [loc, d] of Object.entries(DICTS)) {
      for (const k of Object.keys(en)) expect(d[k as keyof typeof en], `${loc}:${k}`).toBeTruthy();
    }
  });
  it('placeholders match between languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [loc, d] of Object.entries(DICTS)) {
      for (const k of Object.keys(en) as (keyof typeof en)[]) expect(vars(d[k]), `${loc}:${k}`).toBe(vars(en[k]));
    }
  });
});
