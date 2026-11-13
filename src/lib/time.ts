export const DEFAULT_TZ = 'Africa/Kampala';

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** 'YYYY-MM-DD' for a moment in a timezone */
export function localDate(d: Date = new Date(), tz = DEFAULT_TZ): string {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localHour(d: Date, tz = DEFAULT_TZ): number {
  return Number(parts(d, tz).hour);
}

/** Offset of tz from UTC in minutes at moment d (Kampala = +180). */
export function tzOffsetMinutes(d: Date, tz = DEFAULT_TZ): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant for a local wall-clock time in tz, e.g. ('2026-12-01', 9) -> 06:00Z for Kampala. */
export function zonedTime(date: string, hour: number, tz = DEFAULT_TZ, minute = 0): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
}

export function inQuietHours(d: Date, start: number, end: number, tz = DEFAULT_TZ): boolean {
  const h = localHour(d, tz);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/** Next moment after d that is outside quiet hours (the quiet-hours end time, local). */
export function nextAllowedTime(d: Date, start: number, end: number, tz = DEFAULT_TZ): Date {
  if (!inQuietHours(d, start, end, tz)) return d;
  const today = localDate(d, tz);
  const candidate = zonedTime(today, end, tz);
  if (candidate > d) return candidate;
  const tomorrow = localDate(new Date(d.getTime() + 24 * 3600 * 1000), tz);
  return zonedTime(tomorrow, end, tz);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function formatDate(date: string | Date | null | undefined, locale = 'en'): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date.length === 10 ? date + 'T12:00:00Z' : date) : date;
  return d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DEFAULT_TZ });
}
