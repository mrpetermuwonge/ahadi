'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/I18n';
import { StateChip } from '@/components/Ui';
import { apiSend, digits, fmtMoney, withCommas } from '@/components/client-utils';

interface Row {
  id: string; name: string; phone: string; phoneMasked: string; anonymous: boolean; amount: number; paid: number; balance: number;
  state: 'paid' | 'partial' | 'unpaid' | 'overdue'; dueDate: string | null;
  recorded?: 'pending' | 'confirmed' | 'disputed' | null;
}

/** Pledge list with filters (all / paid / partial / unpaid / overdue) and search by name or phone (any format). */
export function PledgeList({ eventId, rows, currency, canAdjust }: { eventId: string; rows: Row[]; currency: string; canAdjust: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | Row['state']>('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newAmount, setNewAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, paid: 0, partial: 0, unpaid: 0, overdue: 0 };
    for (const r of rows) c[r.state]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    // Phone search matches the last 9 digits so 07xx, +2567xx and 2567xx all find the same person.
    const d = digits(term).replace(/^256/, '').replace(/^0/, '');
    return rows.filter((r) => (filter === 'all' || r.state === filter) &&
      (!term || r.name.toLowerCase().includes(term) || (d.length >= 3 && r.phone.replace(/\D/g, '').includes(d))));
  }, [rows, filter, q]);

  async function saveAmount(id: string) {
    const r = await apiSend(`/api/events/${eventId}/adjust-pledge`, { pledgeId: id, amount: Number(digits(newAmount)) });
    if (!r.ok) return setError(r.error);
    setEditing(null);
    router.refresh();
  }

  const filters = ['all', 'paid', 'partial', 'unpaid', 'overdue'] as const;
  return (
    <section className="card p-5">
      <input className="input" type="search" placeholder={t('dash.searchPh')} aria-label={t('dash.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex gap-2 mt-3 overflow-x-auto pb-1" role="tablist">
        {filters.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={`chip text-sm px-3 py-2 min-h-[40px] whitespace-nowrap border ${filter === f ? 'bg-brand text-brand-ink border-brand' : 'bg-card border-line'}`}>
            {f === 'all' ? t('dash.all') : t(`state.${f}` as any)} · {counts[f]}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10">
          <svg aria-hidden className="mx-auto w-20 h-20 text-accent" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="40" cy="40" r="28" /><path d="M28 42l8 8 16-18" /></svg>
          <p className="font-semibold mt-3">{t('dash.empty')}</p>
          <p className="text-sm text-muted mt-1">{t('dash.emptyHint')}</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted py-6 text-center">{t('dash.noMatch')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {shown.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{r.name}{r.anonymous && <span className="text-xs text-muted"> · {t('ev.anonymous')}</span>}</p>
                  <p className="text-sm text-muted">{r.phoneMasked}{r.dueDate ? ` · ${t('dash.due', { date: r.dueDate })}` : ''}</p>
                  {r.recorded && (
                    <span className={`chip mt-1 text-[11px] ${r.recorded === 'disputed' ? 'bg-bad/15 text-bad' : r.recorded === 'confirmed' ? 'bg-ok/15 text-ok' : 'bg-accent/25 text-ink'}`}>
                      {t(`rp.chip.${r.recorded}` as any)}
                    </span>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold">{fmtMoney(r.amount, currency)}</p>
                  <p className="text-xs text-muted">{t('my.paid')}: {fmtMoney(r.paid, currency)}</p>
                  <div className="mt-1"><StateChip state={r.state} /></div>
                </div>
              </div>
              {r.balance < 0 && <p className="text-xs text-warn mt-1">{t('dash.overpaid')}: {fmtMoney(-r.balance, currency)}</p>}
              {canAdjust && (editing === r.id ? (
                <div className="mt-2 flex gap-2 items-center">
                  <label className="sr-only" htmlFor={`na-${r.id}`}>{t('dash.newAmount')}</label>
                  <input id={`na-${r.id}`} className="input min-h-[40px]" inputMode="numeric" value={withCommas(newAmount)} onChange={(e) => setNewAmount(digits(e.target.value))} />
                  <button className="btn-primary min-h-[40px] px-3 text-sm" onClick={() => saveAmount(r.id)}>{t('a.save')}</button>
                  <button className="btn-ghost min-h-[40px] px-3 text-sm" onClick={() => setEditing(null)}>{t('a.cancel')}</button>
                </div>
              ) : (
                <button className="text-sm text-brand font-semibold mt-1 min-h-[32px]" onClick={() => { setEditing(r.id); setNewAmount(String(r.amount)); setError(null); }}>
                  {t('dash.adjust')}
                </button>
              ))}
              {editing === r.id && error && <p role="alert" className="text-xs text-bad mt-1">{t(`err.${error}` as any)}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
