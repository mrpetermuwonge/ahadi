import ExcelJS from 'exceljs';
import type { Db } from '../db';
import { APP_URL } from '../config';
import { audit } from '../audit';
import type { EventType } from '../eventTypes';
import { newId, randomId } from '../ids';
import { post, pledgeLines, pledgeBalance, reverse } from '../ledger';
import { formatMoney, parseAmount } from '../money';
import { notify } from '../notify';
import { normalizePhone } from '../phone';
import { getSettings } from '../settings';
import { addDays, localDate } from '../time';
import { PledgeError, hasEventPass, scheduleReminders } from './pledges';

/**
 * Pledges made out loud at a committee meeting or written on paper: the organizer or treasurer records them
 * (one at a time, or a whole Excel/CSV list). Each person gets a WhatsApp/SMS with their personal link to
 * confirm, pay, or say "this is not my pledge". Recorded pledges are marked so everyone can tell them apart.
 */
export interface RecordRow { name: string; phone: string; amount: number; dueDate?: string | null }
export interface RecordResult { added: number; duplicates: string[]; errors: { row: number; error: string }[] }

const MAX_ROWS = 500;

export async function recordPledges(db: Db, eventId: string, actor: string, rows: RecordRow[], source: 'committee' | 'import'): Promise<RecordResult> {
  if (rows.length === 0) throw new PledgeError('invalid_input');
  if (rows.length > MAX_ROWS) throw new PledgeError('too_many_rows');
  const [event] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  if (!event || event.status !== 'active' || event.frozen) throw new PledgeError('event_closed');
  const settings = await getSettings(db);
  const today = localDate();
  const defaultDue = event.event_date && String(event.event_date) > today ? String(event.event_date).slice(0, 10) : addDays(today, 30);
  const result: RecordResult = { added: 0, duplicates: [], errors: [] };
  const toNotify: { phone: string; name: string; amount: number; token: string; pledgeId: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const phone = normalizePhone(r.phone);
    const name = (r.name ?? '').trim().replace(/\s+/g, ' ');
    const due = r.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate) ? r.dueDate : defaultDue;
    if (!phone) { result.errors.push({ row: i + 1, error: 'invalid_phone' }); continue; }
    if (name.length < 2 || name.length > 80) { result.errors.push({ row: i + 1, error: 'invalid_name' }); continue; }
    if (!Number.isSafeInteger(r.amount) || r.amount <= 0) { result.errors.push({ row: i + 1, error: 'invalid_amount' }); continue; }
    if (due < today) { result.errors.push({ row: i + 1, error: 'due_date_past' }); continue; }
    try {
      const out = await db.tx(async (q) => {
        let [pl] = await q.query('SELECT * FROM pledgers WHERE phone=$1', [phone]);
        if (!pl) {
          // The person did not type this themselves: their consent is "recorded by the committee" until they confirm.
          [pl] = await q.query(`INSERT INTO pledgers(id, phone, name, consent_at, consent_version) VALUES ($1,$2,$3, now(), 'recorded-by-committee') RETURNING *`, [newId('plr'), phone, name]);
        }
        const [dup] = await q.query('SELECT id FROM pledges WHERE event_id=$1 AND pledger_id=$2', [eventId, pl.id]);
        if (dup) return { duplicate: true as const };
        if (!(await hasEventPass(q, eventId))) {
          const [{ n }] = await q.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM pledges WHERE event_id=$1', [eventId]);
          if (n >= settings.free_max_pledges) throw new PledgeError('event_full');
        }
        const id = newId('plg');
        const token = randomId(24);
        await q.query(
          `INSERT INTO pledges(id, event_id, pledger_id, access_token, amount, currency, display_name, anonymous, pay_plan, due_date, source, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,false,'later',$8,$9,$10)`,
          [id, eventId, pl.id, token, r.amount, event.currency, name, due, source, actor],
        );
        await post(q, { eventId, kind: 'pledge', sourceType: 'pledge', sourceId: id, currency: event.currency, createdBy: actor, lines: pledgeLines(id, r.amount) });
        return { duplicate: false as const, id, token };
      });
      if (out.duplicate) { result.duplicates.push(name); continue; }
      result.added++;
      toNotify.push({ phone, name, amount: r.amount, token: out.token, pledgeId: out.id });
    } catch (e) {
      if (e instanceof PledgeError && e.code === 'event_full') { result.errors.push({ row: i + 1, error: 'event_full' }); break; }
      throw e;
    }
  }
  await audit(db, { actor, action: 'pledges.recorded', entityType: 'event', entityId: eventId, eventId, details: { source, added: result.added, duplicates: result.duplicates.length, errors: result.errors.length } });
  for (const n of toNotify) {
    await scheduleReminders(db, n.pledgeId);
    await notify(db, {
      to: n.phone, stage: 'recorded', eventType: event.type as EventType, locale: 'en', purpose: 'recorded', eventId,
      vars: { name: n.name.split(' ')[0]!, amount: formatMoney(n.amount, event.currency), event: event.title, link: `${APP_URL()}/p/${n.token}` },
    }).catch(() => {});
  }
  return result;
}

/** Read an Excel (.xlsx) or CSV list: columns Name, Phone, Amount and optional Due date (YYYY-MM-DD). */
export async function parsePledgeList(bytes: Uint8Array, filename: string): Promise<{ rows: RecordRow[]; errors: { row: number; error: string }[] }> {
  let table: string[][] = [];
  if (/\.xlsx$/i.test(filename)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new PledgeError('invalid_file');
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (v && typeof v === 'object' && 'text' in (v as any)) return String((v as any).text);
        return v === null || v === undefined ? '' : String(v);
      });
      table.push(vals);
    });
  } else {
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
    table = text.split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine);
  }
  if (table.length === 0) throw new PledgeError('invalid_file');
  const head = table[0]!.map((h) => h.toLowerCase().trim());
  const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
  let iName = col('name', 'jina', 'linnya'), iPhone = col('phone', 'simu', 'ssimu', 'number'), iAmount = col('amount', 'kiasi', 'ssente', 'pledge'), iDue = col('due', 'date', 'tarehe');
  let start = 1;
  if (iName < 0 || iPhone < 0 || iAmount < 0) { iName = 0; iPhone = 1; iAmount = 2; iDue = 3; start = 0; } // no header row: Name, Phone, Amount, Due
  const rows: RecordRow[] = [];
  const errors: { row: number; error: string }[] = [];
  for (let i = start; i < table.length && rows.length + errors.length < MAX_ROWS + 1; i++) {
    const r = table[i]!;
    const amount = parseAmount(String(r[iAmount] ?? '').replace(/ugx/i, '').trim());
    if (!r[iName] && !r[iPhone]) continue;
    if (!amount) { errors.push({ row: i + 1, error: 'invalid_amount' }); continue; }
    rows.push({ name: String(r[iName] ?? ''), phone: String(r[iPhone] ?? ''), amount, dueDate: iDue >= 0 ? String(r[iDue] ?? '').slice(0, 10) || null : null });
  }
  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The pledger confirms a pledge the committee recorded for them. */
export async function confirmRecordedPledge(db: Db, token: string) {
  const rows = await db.query(`UPDATE pledges SET confirmed_at=now() WHERE access_token=$1 AND source<>'self' AND confirmed_at IS NULL AND disputed_at IS NULL RETURNING id, event_id`, [token]);
  if (rows[0]) await audit(db, { actor: null, action: 'pledge.confirmed', entityType: 'pledge', entityId: rows[0].id, eventId: rows[0].event_id });
  return { ok: true };
}

/**
 * "This is not my pledge": the committee recorded a pledge this person did not make. The pledge is undone in the
 * ledger (it no longer counts) and its reminders stop. Not possible once something was paid on it.
 */
export async function disputeRecordedPledge(db: Db, token: string) {
  const [p] = await db.query(`SELECT * FROM pledges WHERE access_token=$1`, [token]);
  if (!p || p.source === 'self' || p.disputed_at) throw new PledgeError('not_found');
  await db.tx(async (q) => {
    const bal = await pledgeBalance(q, p.id);
    if (bal.paid > 0) throw new PledgeError('already_paid');
    const journals = await q.query(
      `SELECT DISTINCT j.id FROM ledger_journals j JOIN ledger_entries le ON le.journal_id=j.id
        WHERE le.pledge_id=$1 AND j.kind IN ('pledge','pledge_change')
          AND NOT EXISTS (SELECT 1 FROM ledger_journals r WHERE r.reverses_id=j.id)`, [p.id]);
    for (const j of journals) await reverse(q, j.id, null, 'Pledger said this is not their pledge');
    await q.query(`UPDATE pledges SET disputed_at=now() WHERE id=$1`, [p.id]);
    await q.query(`UPDATE reminders SET status='skipped', skip_reason='disputed' WHERE pledge_id=$1 AND status='scheduled'`, [p.id]);
    await audit(q, { actor: null, action: 'pledge.disputed', entityType: 'pledge', entityId: p.id, eventId: p.event_id });
  });
  return { ok: true };
}
