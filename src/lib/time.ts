/**
 * Time-zone strategy: an itinerary time is stored as
 *   (instant UTC, IANA zone of the place where it happens).
 * Users enter *local wall-clock time at the place*; we convert to a UTC instant using
 * that place's zone, and always render using that same zone, never the viewer's.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` at instant `utcMs`: local wall time minus UTC. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const part of dtf(tz).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "2026-06-12" + "08:00" in `tz` -> UTC Date. Nonexistent (DST gap) times roll forward. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = naive - tzOffsetMs(naive, tz);
  const off2 = tzOffsetMs(utc, tz);
  if (naive - off2 !== utc) utc = naive - off2; // crossed a DST boundary
  return new Date(utc);
}

/** The local calendar date ("YYYY-MM-DD") of an instant in `tz`. */
export function localDate(instant: Date | string | number, tz: string): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : typeof instant === "number" ? instant : instant.getTime();
  const local = new Date(ms + tzOffsetMs(ms, tz));
  return local.toISOString().slice(0, 10);
}

/** Local "HH:mm" of an instant in `tz`. */
export function localTime(instant: Date | string | number, tz: string): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : typeof instant === "number" ? instant : instant.getTime();
  return new Date(ms + tzOffsetMs(ms, tz)).toISOString().slice(11, 16);
}

/** "8:00 AM" style, in the given zone. */
export function formatTime(instant: Date | string | number, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Short zone label such as "CDT" or "AST". */
export function zoneAbbr(instant: Date | string | number, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

export function formatDateLong(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatDateShort(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A short list of zones for the picker; any valid IANA zone may also be typed. */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Athens',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
