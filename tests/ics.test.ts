import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, triggerFor, REMINDER_CHOICES, type IcsItem } from '../src/lib/ics';
import { zonedToUtc } from '../src/lib/time';

const flight: IcsItem = {
  id: 'f1',
  title: 'Flight, AUS → SJU',
  description: 'Seat 12A; bring ID\nGate B4',
  location: 'Austin–Bergstrom (AUS)',
  address: null,
  localDate: '2026-06-12',
  startAt: zonedToUtc('2026-06-12', '08:00', 'America/Chicago').toISOString(),
  startTz: 'America/Chicago',
  endAt: zonedToUtc('2026-06-12', '13:30', 'America/Puerto_Rico').toISOString(),
  endTz: 'America/Puerto_Rico',
  confirmationNumber: 'XYZ789',
};
const allDay: IcsItem = { id: 'a1', title: 'Beach day', localDate: '2026-06-13', startAt: null, startTz: null, endAt: null, endTz: null };

describe('ICS export', () => {
  const ics = buildIcs('Puerto Rico', [flight, allDay], new Date('2026-01-01T00:00:00Z'));
  const unfolded = ics.replace(/\r\n /g, '');

  it('is a structurally valid VCALENDAR with CRLF endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VEVENT/g)).toHaveLength(2);
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it('writes correct UTC instants for cross-zone flights (8:00 CDT -> 13:30 AST)', () => {
    expect(unfolded).toContain('DTSTART:20260612T130000Z');
    expect(unfolded).toContain('DTEND:20260612T173000Z');
  });
  it('mentions local times and zones in the description', () => {
    expect(unfolded).toMatch(/Local time: 8:00\\? ?AM CDT/);
    expect(unfolded).toContain('1:30');
    expect(unfolded).toContain('America/Puerto_Rico');
  });
  it('includes title, description, location with proper escaping', () => {
    expect(unfolded).toContain('SUMMARY:Flight\\, AUS → SJU');
    expect(unfolded).toContain('Seat 12A\\; bring ID\\nGate B4');
    expect(unfolded).toContain('LOCATION:Austin–Bergstrom (AUS)');
    expect(unfolded).toContain('Confirmation: XYZ789');
  });
  it('untimed items are all-day events ending the next day', () => {
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20260613');
    expect(unfolded).toContain('DTEND;VALUE=DATE:20260614');
  });
  it('has stable unique UIDs', () => {
    expect(unfolded).toContain('UID:f1@tripnest');
    expect(unfolded).toContain('UID:a1@tripnest');
  });
  it('escape/fold helpers', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = foldLine('X'.repeat(200));
    expect(folded.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('X'.repeat(200));
    const emoji = foldLine('SUMMARY:' + '✈️'.repeat(50));
    expect(emoji.replace(/\r\n /g, '')).toBe('SUMMARY:' + '✈️'.repeat(50));
  });
});

describe('ICS reminders', () => {
  const timed = { ...flight, itemType: 'flight' };
  const hotel: IcsItem = { ...flight, id: 'h1', title: 'Hotel check-in', itemType: 'hotel' };
  const alarms = (ics: string) => ics.match(/BEGIN:VALARM/g)?.length ?? 0;
  const now = new Date('2026-01-01T00:00:00Z');

  it('adds nothing unless asked', () => {
    expect(alarms(buildIcs('T', [timed], now))).toBe(0);
    expect(alarms(buildIcs('T', [timed], now, { reminderMinutes: null }))).toBe(0);
  });
  it('writes a display alarm that fires the chosen time before a timed event', () => {
    const ics = buildIcs('T', [timed], now, { reminderMinutes: 180 }).replace(/\r\n /g, '');
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\n');
    expect(ics).toContain('TRIGGER:-PT3H');
    expect(ics).toContain('DESCRIPTION:Flight' + String.fromCharCode(92) + ', AUS → SJU in 3 hours'); // the comma is escaped
    // the alarm is inside its event
    expect(ics.indexOf('BEGIN:VALARM')).toBeGreaterThan(ics.indexOf('BEGIN:VEVENT'));
    expect(ics.indexOf('END:VALARM')).toBeLessThan(ics.indexOf('END:VEVENT'));
  });
  it('skips all-day items, hotels and free time', () => {
    expect(alarms(buildIcs('T', [allDay, hotel, { ...timed, id: 'f2', itemType: 'free_time' }], now, { reminderMinutes: 60 }))).toBe(0);
  });
  it('uses valid durations for every choice', () => {
    expect(triggerFor(30)).toBe('-PT30M');
    expect(triggerFor(60)).toBe('-PT1H');
    expect(triggerFor(90)).toBe('-PT90M');
    expect(triggerFor(1440)).toBe('-P1D');
    expect(triggerFor(2880)).toBe('-P2D');
    for (const bad of [0, -5, 1.5, NaN, 99999]) expect(() => triggerFor(bad)).toThrow();
    for (const c of REMINDER_CHOICES) if (c.minutes !== null) expect(triggerFor(c.minutes)).toMatch(/^-P(T\d+[HM]|\d+D)$/);
  });
  it('keeps lines short and the file well-formed with alarms present', () => {
    const ics = buildIcs('T', [timed, allDay], now, { reminderMinutes: 60 });
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(ics.match(/END:VALARM/g)!.length);
  });
});
