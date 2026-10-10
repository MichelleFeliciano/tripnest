/**
 * RFC 5545 iCalendar export.
 * Time-zone handling: timed events are written as absolute UTC instants (DTSTART:...Z),
 * which every calendar client converts into the viewer's zone correctly. The local time
 * at the place (with zone abbreviation) is added to the description so context is not lost.
 * Untimed items become all-day events (VALUE=DATE).
 */
import { formatTime, zoneAbbr } from './time';

export interface IcsItem {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  address?: string | null;
  localDate: string;
  startAt: string | null;
  startTz: string | null;
  endAt: string | null;
  endTz: string | null;
  website?: string | null;
  confirmationNumber?: string | null;
  /** The item type; hotels and free time do not get reminders (a check-in time is not something to be woken for). */
  itemType?: string | null;
}

/** Minutes before the start that a calendar should remind you; null for no reminders. */
export const REMINDER_CHOICES: { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'No reminders' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
];
const NO_REMINDER_TYPES = ['hotel', 'free_time'];

/** RFC 5545 duration for "this long before": -PT30M, -PT3H, -P1D. */
export function triggerFor(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 14 * 1440) throw new Error('Invalid reminder time');
  if (minutes % 1440 === 0) return `-P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

const reminderText = (minutes: number) => (minutes % 1440 === 0 ? (minutes === 1440 ? 'tomorrow' : `in ${minutes / 1440} days`) : minutes % 60 === 0 ? (minutes === 60 ? 'in 1 hour' : `in ${minutes / 60} hours`) : `in ${minutes} minutes`);

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per line (UTF-8 aware), continuation lines start with a space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // leading space counts
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dateValue(iso: string): string {
  return iso.replace(/-/g, '');
}

function nextDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function buildIcs(calName: string, items: IcsItem[], now: Date = new Date(), opts: { reminderMinutes?: number | null } = {}): string {
  const reminder = opts.reminderMinutes ?? null;
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TripNest//Trip Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(calName)}`];
  for (const it of items) {
    const desc: string[] = [];
    if (it.startAt && it.startTz) {
      let when = `${formatTime(it.startAt, it.startTz)} ${zoneAbbr(it.startAt, it.startTz)}`;
      let zones = it.startTz;
      if (it.endAt && it.endTz) {
        when += ` – ${formatTime(it.endAt, it.endTz)} ${zoneAbbr(it.endAt, it.endTz)}`;
        if (it.endTz !== it.startTz) zones += ` → ${it.endTz}`;
      }
      desc.push(`Local time: ${when} (${zones})`);
    }
    if (it.description) desc.push(it.description);
    if (it.confirmationNumber) desc.push(`Confirmation: ${it.confirmationNumber}`);
    if (it.website) desc.push(it.website);
    const location = [it.location, it.address].filter(Boolean).join(', ');

    lines.push('BEGIN:VEVENT', `UID:${it.id}@tripnest`, `DTSTAMP:${utcStamp(now)}`);
    if (it.startAt) {
      const start = new Date(it.startAt);
      lines.push(`DTSTART:${utcStamp(start)}`);
      // RFC: an event with no end defaults to zero duration; keep it explicit for clarity.
      lines.push(`DTEND:${utcStamp(it.endAt ? new Date(it.endAt) : start)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(it.localDate)}`, `DTEND;VALUE=DATE:${dateValue(nextDate(it.localDate))}`);
    }
    lines.push(`SUMMARY:${escapeText(it.title)}`);
    if (desc.length) lines.push(`DESCRIPTION:${escapeText(desc.join('\n'))}`);
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    // Only timed items get a reminder: an all-day item has no moment to count back from.
    if (reminder !== null && it.startAt && !NO_REMINDER_TYPES.includes(it.itemType ?? '')) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(`${it.title} ${reminderText(reminder)}`)}`, `TRIGGER:${triggerFor(reminder)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
