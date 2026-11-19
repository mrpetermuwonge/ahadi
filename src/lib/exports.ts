import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import ExcelJS from 'exceljs';
import type { Db } from './db';
import { eventTotals, type EventTotals } from './ledger';
import { pledgeRows, type PledgeRow } from './services/events';
import { formatMoney } from './money';
import { formatDate, localDate } from './time';
import { maskPhone } from './phone';
import type { T } from '@/i18n';

/** Standard PDF fonts only cover Latin-1; replace anything else so generation never fails. */
const safe = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

export interface ExportData {
  event: any;
  totals: EventTotals;
  rows: PledgeRow[];
}

/** One loader for every export, using the same ledger functions as the dashboard, so totals always match. */
export async function loadExport(db: Db, eventId: string): Promise<ExportData> {
  const [event] = await db.query('SELECT * FROM events WHERE id=$1', [eventId]);
  const rows = (await pledgeRows(db, eventId)).filter((r) => r.recorded !== 'disputed'); // undone: not a pledge any more
  return { event, totals: await eventTotals(db, eventId), rows };
}

function headers(t: T) {
  return [t('ledger.pledger'), 'Phone', t('dash.pledged'), t('my.paid'), t('my.balance'), 'Status', t('pf.dueDate')];
}

function rowValues(r: PledgeRow, t: T) {
  return [r.name, r.phone, r.amount, r.paid, r.balance, t(`state.${r.state}` as any), r.dueDate ?? ''];
}

export function toCsv(d: ExportData, t: T): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    // Neutralise spreadsheet formula injection and quote everything.
    const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${guarded.replace(/"/g, '""')}"`;
  };
  const lines = [headers(t).map(esc).join(',')];
  for (const r of d.rows) lines.push(rowValues(r, t).map(esc).join(','));
  lines.push('');
  lines.push([t('dash.pledged'), d.totals.pledged].map(esc).join(','));
  lines.push([t('dash.collected'), d.totals.collected].map(esc).join(','));
  lines.push([t('dash.outstanding'), d.totals.outstanding].map(esc).join(','));
  return '﻿' + lines.join('\r\n');
}

export async function toXlsx(d: ExportData, t: T): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ahadi';
  const ws = wb.addWorksheet(t('ledger.title'));
  ws.addRow([d.event.title]).font = { bold: true, size: 14 };
  ws.addRow([`${t('dash.pledged')}: ${d.totals.pledged}`, `${t('dash.collected')}: ${d.totals.collected}`, `${t('dash.outstanding')}: ${d.totals.outstanding}`, d.event.currency]);
  ws.addRow([]);
  const h = ws.addRow(headers(t));
  h.font = { bold: true };
  for (const r of d.rows) ws.addRow(rowValues(r, t));
  for (const c of [3, 4, 5]) ws.getColumn(c).numFmt = '#,##0';
  ws.columns.forEach((c) => (c.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function newPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  return { pdf, font, bold };
}

const TEAL = rgb(13 / 255, 92 / 255, 84 / 255);
const MUTED = rgb(0.36, 0.41, 0.4);

function header(page: PDFPage, bold: PDFFont, font: PDFFont, title: string, sub: string) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: TEAL });
  page.drawText('Ahadi', { x: 36, y: height - 45, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(title).slice(0, 70), { x: 36, y: height - 100, size: 16, font: bold });
  page.drawText(safe(sub), { x: 36, y: height - 118, size: 10, font, color: MUTED });
}

/** Full ledger PDF: totals + every pledge, paginated. */
export async function toLedgerPdf(d: ExportData, t: T): Promise<Uint8Array> {
  const { pdf, font, bold } = await newPdf();
  const cur = d.event.currency;
  let page = pdf.addPage([595, 842]);
  header(page, bold, font, d.event.title, `${t('ledger.title')} · ${localDate()}`);
  let y = 842 - 150;
  const totals: [string, number][] = [
    [t('dash.pledged'), d.totals.pledged],
    [t('dash.collected'), d.totals.collected],
    [t('dash.outstanding'), d.totals.outstanding],
  ];
  totals.forEach(([k, v], i) => {
    page.drawText(safe(k), { x: 36 + i * 180, y, size: 9, font, color: MUTED });
    page.drawText(safe(formatMoney(v, cur)), { x: 36 + i * 180, y: y - 16, size: 13, font: bold });
  });
  y -= 50;
  const cols = [36, 200, 300, 390, 480];
  const head = [t('ledger.pledger'), t('dash.pledged'), t('my.paid'), t('my.balance'), 'Status'];
  const drawHead = () => {
    head.forEach((h, i) => page.drawText(safe(h), { x: cols[i], y, size: 9, font: bold }));
    y -= 6;
    page.drawLine({ start: { x: 36, y }, end: { x: 559, y }, thickness: 0.5, color: MUTED });
    y -= 14;
  };
  drawHead();
  for (const r of d.rows) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 842 - 50;
      drawHead();
    }
    const vals = [`${r.name} (${maskPhone(r.phone)})`, r.amount.toLocaleString('en-US'), r.paid.toLocaleString('en-US'), r.balance.toLocaleString('en-US'), t(`state.${r.state}` as any)];
    vals.forEach((v, i) => page.drawText(safe(v).slice(0, i === 0 ? 34 : 18), { x: cols[i], y, size: 9, font }));
    y -= 16;
  }
  return pdf.save();
}

/** One-page event-day report with the totals a committee reads out. */
export async function toEventDayPdf(d: ExportData, t: T): Promise<Uint8Array> {
  const { pdf, font, bold } = await newPdf();
  const cur = d.event.currency;
  const page = pdf.addPage([595, 842]);
  header(page, bold, font, d.event.title, `${t('dash.report')} · ${formatDate(d.event.event_date ?? localDate())}`);
  const items: [string, number | string][] = [
    [t('dash.pledged'), formatMoney(d.totals.pledged, cur)],
    [t('dash.collected'), formatMoney(d.totals.collected, cur)],
    [t('dash.offline'), formatMoney(d.totals.collectedOffline, cur)],
    [t('dash.outstanding'), formatMoney(d.totals.outstanding, cur)],
    [t('dash.available'), formatMoney(d.totals.available, cur)],
    [t('dash.target'), d.event.target_amount ? formatMoney(Number(d.event.target_amount), cur) : '-'],
    [t('dash.pledgers', { n: d.rows.length }), ''],
  ];
  let y = 842 - 170;
  for (const [k, v] of items) {
    page.drawText(safe(k), { x: 36, y, size: 13, font });
    page.drawText(safe(String(v)), { x: 330, y, size: 15, font: bold });
    y -= 34;
  }
  const counts = ['paid', 'partial', 'unpaid', 'overdue'].map((s) => [t(`state.${s}` as any), d.rows.filter((r) => r.state === s).length] as const);
  y -= 10;
  counts.forEach(([k, n], i) => {
    page.drawRectangle({ x: 36 + i * 132, y: y - 40, width: 122, height: 56, color: rgb(0.94, 0.96, 0.95) });
    page.drawText(String(n), { x: 48 + i * 132, y: y - 12, size: 20, font: bold, color: TEAL });
    page.drawText(safe(k), { x: 48 + i * 132, y: y - 32, size: 10, font, color: MUTED });
  });
  return pdf.save();
}

export async function toReceiptPdf(lines: [string, string][], amount: string, title: string): Promise<Uint8Array> {
  const { pdf, font, bold } = await newPdf();
  const page = pdf.addPage([420, 520]);
  page.drawRectangle({ x: 0, y: 450, width: 420, height: 70, color: TEAL });
  page.drawText(safe(title), { x: 28, y: 478, size: 18, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safe(amount), { x: 28, y: 400, size: 26, font: bold });
  let y = 350;
  for (const [k, v] of lines) {
    page.drawText(safe(k), { x: 28, y, size: 11, font, color: MUTED });
    page.drawText(safe(v).slice(0, 40), { x: 170, y, size: 11, font: bold });
    y -= 30;
  }
  return pdf.save();
}
