import { getDb } from '@/lib/db';
import { eventForUser } from '@/lib/services/events';
import { eventTotals } from '@/lib/ledger';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatMoney } from '@/lib/money';
import { formatPhone } from '@/lib/phone';
import { EVENT_TYPES, type EventType } from '@/lib/eventTypes';
import { Alert } from '@/components/Ui';
import { ActionButton } from '../ActionButton';
import { PayoutForm } from './PayoutForm';
import { AddPhone } from '@/components/AddPhone';
import type { Key } from '@/i18n';

export default async function PayoutsPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, role } = await eventForUser(db, params.id, user, 'treasurer');
  const { t } = getT();
  const totals = await eventTotals(db, e.id);
  const payouts = await db.query(
    `SELECT p.*, a.label, a.phone, a.bank_name, a.account_no FROM payouts p JOIN payout_accounts a ON a.id=p.account_id WHERE p.event_id=$1 ORDER BY p.created_at DESC`,
    [e.id],
  );
  const accounts = await db.query(`SELECT * FROM payout_accounts WHERE user_id=$1 AND verified=true`, [user.id]);
  const tpl = EVENT_TYPES[e.type as EventType];
  return (
    <div className="space-y-4">
      <section className="card p-5">
        <p className="text-sm text-muted">{t('dash.available')}</p>
        <p className="text-3xl font-extrabold text-brand">{formatMoney(totals.available, e.currency)}</p>
        <p className="text-sm text-muted mt-3">{t('po.where')}</p>
        <div className="mt-3 space-y-2">
          {payouts.every((p) => p.status !== 'paid') && <Alert kind="info">{t('po.firstReview')}</Alert>}
          {tpl.secondApproverForFirstPayout && <Alert kind="info">{t('po.sombreNote')}</Alert>}
        </div>
      </section>

      {role === 'owner' && accounts.length === 0 && <AddPhone />}

      {role === 'owner' && !e.frozen && totals.available > 0 && accounts.length > 0 && (
        <PayoutForm eventId={e.id} currency={e.currency} max={totals.available}
          accounts={accounts.map((a) => ({ id: a.id, label: a.kind === 'bank' ? `${a.bank_name} ${a.account_no}` : `${a.label} · ${formatPhone(a.phone)}` }))} />
      )}

      <section className="card p-5">
        <h2 className="font-bold">{t('po.history')}</h2>
        {payouts.length === 0 ? (
          <p className="text-muted mt-2">{t('po.none')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {payouts.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">{formatMoney(Number(p.amount), p.currency)}</p>
                  <p className="text-sm text-muted">{new Date(p.created_at).toISOString().slice(0, 10)} · {p.bank_name ? `${p.bank_name} ${p.account_no}` : formatPhone(p.phone)}</p>
                  <p className="text-sm font-semibold">{t(`po.status.${p.status}` as Key)}</p>
                </div>
                {p.status === 'awaiting_second_approval' && p.requested_by !== user.id && (
                  <ActionButton eventId={e.id} action="second-approve" body={{ payoutId: p.id }} label={t('po.secondApprove')} className="btn-primary min-h-[40px] px-3 text-sm" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
