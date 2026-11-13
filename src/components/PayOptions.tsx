'use client';
import { useT } from './I18n';
import { fmtMoney } from './client-utils';

export type Method = 'mtn' | 'airtel' | 'card';
export interface PayChoice {
  method: Method;
  payPhone: string;
  coverFee: boolean;
  tip: number;
}

/** Mirrors the server fee rule for display. The server recomputes; the status screen shows the authoritative amount. */
export function computeQuote(amount: number, fee: { percent: number; min: number }, c: PayChoice) {
  const f = fee.percent > 0 && amount > 0 ? Math.max(fee.min, Math.ceil((amount * fee.percent) / 100)) : 0;
  const cover = c.coverFee || f >= amount;
  return { fee: f, cover, total: amount + c.tip + (cover ? f : 0), organizerGets: amount - (cover ? 0 : f) };
}

export function detectNetwork(phone: string): Method | null {
  const d = phone.replace(/\D/g, '').replace(/^256/, '').replace(/^0/, '');
  if (/^7[6-9]/.test(d)) return 'mtn';
  if (/^7[045]/.test(d)) return 'airtel';
  return null;
}

export function PayOptions({
  amount, currency, fee, tips, value, onChange,
}: {
  amount: number;
  currency: string;
  fee: { percent: number; min: number };
  tips: number[];
  value: PayChoice;
  onChange: (v: PayChoice) => void;
}) {
  const { t } = useT();
  const q = computeQuote(amount, fee, value);
  const set = (p: Partial<PayChoice>) => onChange({ ...value, ...p });
  const methods: { id: Method; label: string; cls: string }[] = [
    { id: 'mtn', label: t('pf.mtn'), cls: 'bg-[#FFCC00] text-black' },
    { id: 'airtel', label: t('pf.airtel'), cls: 'bg-[#E40000] text-white' },
    { id: 'card', label: t('pf.card'), cls: 'bg-ink text-surface' },
  ];
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="label">{t('pf.method')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {methods.map((m) => (
            <label key={m.id} className={`tap cursor-pointer rounded-xl border-2 p-2 text-center text-sm font-semibold min-h-[64px] flex flex-col items-center justify-center gap-1 ${value.method === m.id ? 'border-brand bg-brand-soft' : 'border-line bg-card'}`}>
              <input type="radio" name="method" className="sr-only" checked={value.method === m.id} onChange={() => set({ method: m.id })} />
              <span aria-hidden className={`w-7 h-7 rounded-full ${m.cls} text-[10px] font-black flex items-center justify-center`}>{m.id === 'card' ? '▭' : m.id === 'mtn' ? 'M' : 'A'}</span>
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>
      {value.method !== 'card' && (
        <div>
          <label htmlFor="payPhone" className="label">{t('pf.payPhone')}</label>
          <input id="payPhone" className="input" inputMode="tel" autoComplete="tel" value={value.payPhone} onChange={(e) => set({ payPhone: e.target.value })} />
        </div>
      )}
      {tips.length > 0 && (
        <fieldset>
          <legend className="label">{t('pf.tip')}</legend>
          <div className="flex gap-2 flex-wrap">
            {tips.map((tp) => (
              <button type="button" key={tp} onClick={() => set({ tip: tp })}
                className={`chip text-sm px-3 py-2 min-h-[40px] border ${value.tip === tp ? 'bg-brand text-brand-ink border-brand' : 'bg-card border-line'}`}>
                {tp === 0 ? t('pf.noTip') : fmtMoney(tp, currency)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="rounded-xl bg-surface p-4 text-sm space-y-1.5">
        <div className="flex justify-between"><span>{t('pf.toPledge')}</span><span className="font-semibold">{fmtMoney(amount, currency)}</span></div>
        <div className="flex justify-between"><span>{t('pf.fee', { pct: fee.percent })}</span><span>{fmtMoney(q.fee, currency)}</span></div>
        {value.tip > 0 && <div className="flex justify-between"><span>{t('pf.tip')}</span><span>{fmtMoney(value.tip, currency)}</span></div>}
        <label className="flex gap-3 items-start pt-2 cursor-pointer">
          <input type="checkbox" className="mt-1 w-5 h-5 accent-[rgb(var(--brand))]" checked={q.cover} disabled={q.fee >= amount} onChange={(e) => set({ coverFee: e.target.checked })} />
          <span>{t('pf.coverFee')}</span>
        </label>
        <div className="flex justify-between border-t border-line pt-2 text-base"><span className="font-semibold">{t('pf.total')}</span><span className="font-extrabold">{fmtMoney(q.total, currency)}</span></div>
      </div>
    </div>
  );
}
