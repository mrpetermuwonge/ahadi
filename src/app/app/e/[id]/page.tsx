import { getDb } from '@/lib/db';
import { dailyActivity, pledgeRows } from '@/lib/services/events';
import { pageAccess } from '@/lib/pageAccess';
import { eventTotals } from '@/lib/ledger';
import { requireUser } from '@/lib/web';
import { getT } from '@/i18n/server';
import { formatMoney, percent } from '@/lib/money';
import { maskPhone } from '@/lib/phone';
import { ProgressRing } from '@/components/Ui';
import { PledgeList } from './PledgeList';
import { ActionButton } from './ActionButton';
import { RecordPledges, RemindOwing, UpdatesPanel } from './CommitteeTools';
import { listUpdates, owingSummary } from '@/lib/services/engagement';
import { adminCan } from '@/lib/adminPermissions';
import type { Key } from '@/i18n';

export default async function EventDashboard({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const db = await getDb();
  const { event: e, role, perms } = await pageAccess(db, params.id, user, 'event.view');
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
  const contacts = perms['pledges.contacts'];
  const owing = perms['pledgers.remind'] ? await owingSummary(db, e.id) : null;
  const updates = await listUpdates(db, e.id, true);

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

      {totals.collected + totals.outstanding > 0 && <MoneySplit totals={totals} cur={cur} t={t} />}

      {/* What this person can do here, in one line: the organizer, treasurer and helpers each get their own view. */}
      <section className="card p-4 flex gap-3 items-start">
        <svg aria-hidden className="w-6 h-6 shrink-0 text-brand mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
        <div>
          <p className="font-semibold">{t('role.you', { role: t(`role.${role}` as Key) })}</p>
          <p className="text-sm text-muted">{t(`role.${role}.d` as Key)}</p>
        </div>
      </section>

      {(perms['pledges.record'] || owing) && (
        <div className="grid lg:grid-cols-2 gap-4">
          {perms['pledges.record'] && <RecordPledges eventId={e.id} currency={e.currency} canRecordCash={perms['cash.record']} />}
          {owing && <RemindOwing eventId={e.id} currency={e.currency} {...owing} />}
        </div>
      )}

      <UpdatesPanel eventId={e.id} canPost={perms['updates.post']} staffHide={adminCan(user, 'updates.hide')}
        updates={updates.map((u) => ({ id: u.id, body: u.body, image_file_id: u.image_file_id, notified: u.notified, created_at: new Date(u.created_at).toISOString(), hidden_at: u.hidden_at ? new Date(u.hidden_at).toISOString() : null }))} />

      {perms['ledger.export'] && (
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
      )}

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

      {perms['pledges.decideChange'] && changes.length > 0 && (
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

      {perms['messages.moderate'] && pendingMsgs.length > 0 && (
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
        canAdjust={perms['pledges.adjust']}
        rows={rows.map((r) => ({ ...r, phone: contacts ? r.phone : '', phoneMasked: contacts ? r.phone : maskPhone(r.phone) }))}
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

/**
 * Where the money is: what came in through Ahadi (Ahadi holds it until it is withdrawn), what the committee holds
 * itself (cash, bank or mobile money given to them, recorded by the treasurer; never withdrawable through Ahadi,
 * no Ahadi fee) and what is still owed. The three parts add up to everything pledged.
 */
function MoneySplit({ totals, cur, t }: { totals: Awaited<ReturnType<typeof eventTotals>>; cur: string; t: (k: Key, v?: Record<string, string | number>) => string }) {
  const parts = [
    { key: 'online', label: t('ms.online'), value: totals.collectedOnline, note: t('ms.onlineNote', { a: formatMoney(totals.available, cur), p: formatMoney(totals.paidOut + totals.payoutPending, cur) }), cls: 'bg-brand' },
    { key: 'offline', label: t('ms.offline'), value: totals.collectedOffline, note: t('ms.offlineNote'), cls: 'bg-accent' },
    { key: 'owed', label: t('dash.outstanding'), value: totals.outstanding, note: t('ms.owedNote'), cls: 'bg-line' },
  ];
  const sum = parts.reduce((x, p) => x + Math.max(0, p.value), 0) || 1;
  return (
    <section className="card p-5" aria-labelledby="ms-title">
      <h2 id="ms-title" className="font-bold">{t('ms.title')}</h2>
      <div className="flex h-3 rounded-full overflow-hidden mt-3 bg-line" aria-hidden>
        {parts.map((p) => p.value > 0 && <div key={p.key} className={p.cls} style={{ width: `${(p.value / sum) * 100}%` }} />)}
      </div>
      <dl className="grid sm:grid-cols-3 gap-4 mt-4">
        {parts.map((p) => (
          <div key={p.key} className="flex gap-2">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${p.cls}`} aria-hidden />
            <div>
              <dt className="text-sm text-muted">{p.label}</dt>
              <dd className="text-lg font-bold">{formatMoney(p.value, cur)}</dd>
              <dd className="text-xs text-muted">{p.note}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
