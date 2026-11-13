import { getDb } from '@/lib/db';
import { dailyActivity, eventForUser, pledgeRows } from '@/lib/services/events';
import { eventTotals } from '@/lib/ledger';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatMoney, percent } from '@/lib/money';
import { maskPhone } from '@/lib/phone';
import { ProgressRing } from '@/components/Ui';
import { PledgeList } from './PledgeList';
import { ActionButton } from './ActionButton';

export default async function EventDashboard({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, role } = await eventForUser(db, params.id, user, 'viewer');
  const { t } = getT();
  const totals = await eventTotals(db, e.id);
  const rows = await pledgeRows(db, e.id);
  const activity = await dailyActivity(db, e.id);
  const changes = await db.query(
    `SELECT c.id, c.new_amount, p.amount, p.display_name FROM pledge_change_requests c JOIN pledges p ON p.id=c.pledge_id
      WHERE p.event_id=$1 AND c.status='pending' ORDER BY c.created_at`,
    [e.id],
  );
  const target = e.target_amount ? Number(e.target_amount) : null;
  const cur = e.currency;
  const maxDay = Math.max(1, ...activity.map((a) => Math.max(Number(a.pledged), Number(a.collected))));
  const pendingMsgs = rows.filter((r) => r.message && r.messageStatus === 'pending');
  const isOwner = role === 'owner';

  return (
    <div className="space-y-4">
      <section className="card p-5 grid sm:grid-cols-[auto,1fr] gap-6 items-center">
        <div className="mx-auto">
          <ProgressRing collected={totals.collected} pledged={totals.pledged} target={target}
            label={<><span className="text-3xl font-extrabold">{percent(totals.collected, target ?? totals.pledged)}%</span><span className="text-xs text-muted">{t('dash.collected')}</span></>} />
        </div>
        <dl className="grid grid-cols-2 gap-4">
          <Stat label={t('dash.pledged')} value={formatMoney(totals.pledged, cur)} />
          <Stat label={t('dash.collected')} value={formatMoney(totals.collected, cur)} strong />
          <Stat label={t('dash.outstanding')} value={formatMoney(totals.outstanding, cur)} />
          <Stat label={target ? t('dash.target') : t('dash.offline')} value={formatMoney(target ?? totals.collectedOffline, cur)} />
          <Stat label={t('dash.available')} value={formatMoney(totals.available, cur)} />
          <Stat label={t('dash.pledgers', { n: totals.pledgeCount })} value={totals.overpaid > 0 ? `${t('dash.overpaid')}: ${formatMoney(totals.overpaid, cur)}` : ''} />
        </dl>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{t('dash.export')}</h2>
          <div className="flex flex-wrap gap-2">
            <a className="btn-outline min-h-[40px] px-3 text-sm" href={`/api/events/${e.id}/export?format=csv`}>{t('dash.exportCsv')}</a>
            <a className="btn-outline min-h-[40px] px-3 text-sm" href={`/api/events/${e.id}/export?format=xlsx`}>{t('dash.exportXlsx')}</a>
            <a className="btn-outline min-h-[40px] px-3 text-sm" href={`/api/events/${e.id}/export?format=pdf`}>{t('dash.exportPdf')}</a>
            <a className="btn-outline min-h-[40px] px-3 text-sm" href={`/api/events/${e.id}/export?format=report`}>{t('dash.report')}</a>
          </div>
        </div>
      </section>

      {activity.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">{t('dash.activity')}</h2>
          <div className="mt-4 flex items-end gap-1.5 h-28" role="img" aria-label={t('dash.activity')}>
            {activity.map((a) => (
              <div key={a.day} className="flex-1 flex items-end gap-0.5 h-full" title={`${a.day}: ${formatMoney(Number(a.pledged), cur)} / ${formatMoney(Number(a.collected), cur)}`}>
                <div className="flex-1 bg-accent/50 rounded-t" style={{ height: `${(Number(a.pledged) / maxDay) * 100}%` }} />
                <div className="flex-1 bg-brand rounded-t" style={{ height: `${(Number(a.collected) / maxDay) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-accent/50" />{t('dash.pledged')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-brand" />{t('dash.collected')}</span>
          </div>
        </section>
      )}

      {isOwner && changes.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">{t('dash.changeRequests')}</h2>
          <ul className="mt-3 space-y-3">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('dash.reduceTo', { name: c.display_name, from: formatMoney(Number(c.amount), cur), to: formatMoney(Number(c.new_amount), cur) })}</span>
                <span className="flex gap-2">
                  <ActionButton eventId={e.id} action="decide-change" body={{ requestId: c.id, approve: true }} label={t('a.approve')} className="btn-primary min-h-[40px] px-3 text-sm" />
                  <ActionButton eventId={e.id} action="decide-change" body={{ requestId: c.id, approve: false }} label={t('a.reject')} className="btn-outline min-h-[40px] px-3 text-sm" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isOwner && pendingMsgs.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">{t('dash.messages')}</h2>
          <ul className="mt-3 space-y-3">
            {pendingMsgs.map((m) => (
              <li key={m.id} className="rounded-xl bg-surface p-3">
                <p>“{m.message}” <span className="text-sm text-muted">— {m.name}</span></p>
                <div className="flex gap-2 mt-2">
                  <ActionButton eventId={e.id} action="moderate-message" body={{ pledgeId: m.id, status: 'approved' }} label={t('a.approve')} className="btn-primary min-h-[40px] px-3 text-sm" />
                  <ActionButton eventId={e.id} action="moderate-message" body={{ pledgeId: m.id, status: 'hidden' }} label={t('dash.hide')} className="btn-outline min-h-[40px] px-3 text-sm" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PledgeList
        eventId={e.id}
        currency={cur}
        canAdjust={isOwner}
        rows={rows.map((r) => ({ ...r, phone: role === 'viewer' ? '' : r.phone, phoneMasked: role === 'viewer' ? maskPhone(r.phone) : r.phone }))}
      />
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={strong ? 'text-xl font-extrabold text-brand' : 'text-lg font-bold'}>{value}</dd>
    </div>
  );
}
