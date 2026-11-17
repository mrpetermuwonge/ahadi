import { getDb } from '@/lib/db';
import { pageAccess } from '@/lib/pageAccess';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { ManualEntry } from './ManualEntry';
import { ReverseButton } from './ReverseButton';
import type { Key } from '@/i18n';

/** Treasurer ledger: every journal affecting pledges, newest first, plus manual entry and reversals. */
export default async function LedgerPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, perms } = await pageAccess(db, params.id, user, 'ledger.view');
  const { t } = getT();
  const journals = await db.query(
    `SELECT j.id, j.kind, j.memo, j.receipt_no, j.created_at, j.reverses_id, COALESCE(u.phone, u.email) AS by_phone,
            (SELECT p.display_name FROM ledger_entries le JOIN pledges p ON p.id=le.pledge_id WHERE le.journal_id=j.id AND le.pledge_id IS NOT NULL LIMIT 1) AS pledger,
            (SELECT COALESCE(SUM(le.amount),0)::bigint FROM ledger_entries le WHERE le.journal_id=j.id AND le.account='receivable') AS recv,
            (SELECT COALESCE(SUM(le.amount),0)::bigint FROM ledger_entries le WHERE le.journal_id=j.id AND le.account IN ('payout_pending','paid_out') AND le.amount > 0) AS payout,
            EXISTS (SELECT 1 FROM ledger_journals r WHERE r.reverses_id=j.id) AS reversed
       FROM ledger_journals j LEFT JOIN users u ON u.id=j.created_by
      WHERE j.event_id=$1 ORDER BY j.created_at DESC LIMIT 500`,
    [e.id],
  );
  const pledges = await db.query(`SELECT id, display_name FROM pledges WHERE event_id=$1 ORDER BY display_name`, [e.id]);
  const canWrite = perms['cash.record'];
  const canReverse = perms['cash.reverse'];
  return (
    <div className="space-y-4">
      {canWrite && <ManualEntry eventId={e.id} currency={e.currency} pledges={pledges.map((p) => ({ id: p.id, name: p.display_name }))} />}
      <section className="card p-5">
        <h2 className="font-bold">{t('ledger.entries')}</h2>
        <p className="text-sm text-muted mt-1">{t('ledger.auditNote')}</p>
        <div className="mt-3 overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="py-2 font-semibold">{t('ledger.date')}</th>
                <th className="py-2 font-semibold">{t('ledger.type')}</th>
                <th className="py-2 font-semibold">{t('ledger.pledger')}</th>
                <th className="py-2 font-semibold text-right">{t('ledger.amountCol')}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => {
                // Pledge journals raise the receivable; payments lower it. Show the movement in plain terms.
                const amount = Number(j.recv) !== 0 ? Math.abs(Number(j.recv)) : Number(j.payout);
                return (
                  <tr key={j.id} className={`border-b border-line/60 ${j.reversed ? 'opacity-60' : ''}`}>
                    <td className="py-2 whitespace-nowrap">{new Date(j.created_at).toISOString().slice(0, 10)}</td>
                    <td className="py-2">
                      {t(`kind.${j.kind}` as Key)}
                      {j.memo && <span className="block text-xs text-muted">{j.memo}{j.receipt_no ? ` · ${j.receipt_no}` : ''}</span>}
                      {j.by_phone && <span className="block text-xs text-muted">{t('ledger.by')}: {j.by_phone}</span>}
                    </td>
                    <td className="py-2">{j.pledger ?? '—'}</td>
                    <td className="py-2 text-right font-semibold whitespace-nowrap">{Number(j.recv) > 0 && j.kind === 'reversal' ? '−' : ''}{formatMoney(amount, e.currency)}</td>
                    <td className="py-2 text-right">
                      {j.reversed ? <span className="chip bg-line text-muted">{t('ledger.reversed')}</span>
                        : canReverse && j.kind === 'manual_payment' ? <ReverseButton eventId={e.id} journalId={j.id} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
