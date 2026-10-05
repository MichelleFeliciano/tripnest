export const TRIP_STATUSES = ['planning', 'upcoming', 'in_progress', 'completed', 'archived'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const STATUS_LABELS: Record<TripStatus, string> = {
  planning: 'Planning',
  upcoming: 'Upcoming',
  in_progress: 'In Progress',
  completed: 'Completed',
  archived: 'Archived',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isValidIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface TripInput {
  name: string;
  startDate: string;
  endDate: string;
}

/** Returns a list of human-readable problems; empty means valid. */
export function validateTrip(t: TripInput): string[] {
  const errs: string[] = [];
  if (!t.name.trim()) errs.push('Trip name is required');
  if (t.name.trim().length > 120) errs.push('Trip name must be 120 characters or fewer');
  if (!isValidIsoDate(t.startDate)) errs.push('Start date is not a valid date');
  if (!isValidIsoDate(t.endDate)) errs.push('End date is not a valid date');
  if (errs.length === 0 && dayNumber(t.endDate) < dayNumber(t.startDate)) errs.push('End date cannot be before the start date');
  else if (errs.length === 0 && dayNumber(t.endDate) - dayNumber(t.startDate) > 366) errs.push('Trips can be at most one year long');
  return errs;
}

/** Inclusive day count and nights (a same-day trip is 1 day, 0 nights). */
export function tripDuration(startDate: string, endDate: string): { days: number; nights: number } {
  const nights = dayNumber(endDate) - dayNumber(startDate);
  return { days: nights + 1, nights };
}

export function addDays(iso: string, n: number): string {
  const d = new Date((dayNumber(iso) + n) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** All dates in the trip, inclusive. */
export function tripDates(startDate: string, endDate: string): string[] {
  const { days } = tripDuration(startDate, endDate);
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDays(startDate, i));
}

export function dayIndex(startDate: string, date: string): number {
  return dayNumber(date) - dayNumber(startDate) + 1;
}

/** "June 12–19, 2026" style range, locale-independent for stability. */
export function formatDateRange(startDate: string, endDate: string): string {
  const mon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (startDate === endDate) return `${mon[sm - 1]} ${sd}, ${sy}`;
  if (sy === ey && sm === em) return `${mon[sm - 1]} ${sd}–${ed}, ${sy}`;
  if (sy === ey) return `${mon[sm - 1]} ${sd} – ${mon[em - 1]} ${ed}, ${sy}`;
  return `${mon[sm - 1]} ${sd}, ${sy} – ${mon[em - 1]} ${ed}, ${ey}`;
}

/** Status suggested from dates; used only as a hint, never auto-applied. */
export function suggestedStatus(startDate: string, endDate: string, today: string): TripStatus {
  if (today < startDate) return 'upcoming';
  if (today > endDate) return 'completed';
  return 'in_progress';
}
