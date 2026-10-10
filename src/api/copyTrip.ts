/**
 * "Copy this trip": start a new trip from an old one, as a template.
 * The copy keeps the plan (itinerary, packing, to-dos, budget, notes) and drops anything that belongs to the
 * original trip alone: money that was spent or settled, uploaded documents, bookings, confirmation numbers.
 * All dates move by the same number of days so the trip keeps its shape, and wall-clock times stay put in
 * each place's own time zone.
 */
import { exportData, importTrips, type BackupFile } from './backup';
import type { Row, Table } from './db';
import { friendly } from './api';
import { addDays } from '../lib/tasks';
import { localDate, localTime, zonedToUtc } from '../lib/time';
import { validateTrip } from '../lib/trip';

export interface CopyOptions {
  name: string;
  startDate: string;
  itinerary: boolean;
  packing: boolean;
  todo: boolean;
  budget: boolean;
  notes: boolean;
}

export const daysBetween = (a: string, b: string): number => {
  const ms = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
};

/** Same local date/time in the same zone, `delta` days later (or earlier). */
function shiftInstant(instant: string | null, tz: string | null, delta: number): string | null {
  if (!instant) return null;
  const zone = tz ?? 'UTC';
  const date = addDays(localDate(instant, zone), delta);
  return zonedToUtc(date, localTime(instant, zone), zone).toISOString();
}

/** Pure: turns a single-trip backup into the template file. Nothing is written. */
export function makeTemplate(file: BackupFile, o: CopyOptions): BackupFile {
  const trip = file.tables.trips[0];
  const delta = daysBetween(trip.start_date, o.startDate);
  const shift = (d: string | null) => (d ? addDays(d, delta) : null);
  const empty = Object.fromEntries(Object.keys(file.tables).map((t) => [t, [] as Row[]])) as Record<Table, Row[]>;
  const keep = <T extends Row>(rows: T[], f: (r: T) => T): T[] => rows.map(f);

  const tables = { ...empty };
  tables.trips = [{
    ...trip,
    name: o.name.trim(),
    start_date: o.startDate,
    end_date: addDays(trip.end_date, delta),
    status: 'planning',
    notes: o.notes ? trip.notes : null,
    created_at: new Date().toISOString(),
  }];
  tables.travelers = file.tables.travelers;
  tables.destinations = keep(file.tables.destinations, (d) => ({ ...d, arrival_date: shift(d.arrival_date), departure_date: shift(d.departure_date) }));

  const itemIds = new Set<string>();
  if (o.itinerary) {
    tables.itinerary_items = keep(file.tables.itinerary_items, (i) => {
      itemIds.add(i.id);
      return {
        ...i,
        local_date: addDays(i.local_date, delta),
        start_at: shiftInstant(i.start_at, i.start_tz, delta),
        end_at: shiftInstant(i.end_at, i.end_tz ?? i.start_tz, delta),
        confirmation_number: null,
        cost_cents: i.cost_cents, // an estimate worth keeping; actual spending lives in expenses, which are not copied
      };
    });
  }
  if (o.packing) {
    tables.packing_categories = file.tables.packing_categories;
    tables.packing_items = keep(file.tables.packing_items, (p) => ({ ...p, packed: false }));
  }
  if (o.todo) tables.tasks = keep(file.tables.tasks, (t) => ({ ...t, done: false, due_date: shift(t.due_date) }));
  if (o.budget) tables.budgets = file.tables.budgets;
  if (o.notes) {
    const destIds = new Set(file.tables.destinations.map((d) => d.id));
    tables.notes = file.tables.notes.filter((n) => n.scope === 'trip' || (n.scope === 'destination' && destIds.has(n.target_id)) || (n.scope === 'itinerary' && itemIds.has(n.target_id)));
  }
  return { ...file, settings: undefined, files: {}, tables };
}

/** Reads the trip, builds the template and saves it as a brand-new trip. Returns the new trip's id. */
export async function copyTrip(tripId: string, o: CopyOptions): Promise<string> {
  const problems = validateTrip({ name: o.name, startDate: o.startDate, endDate: o.startDate });
  if (problems.length) throw friendly(new Error(problems[0]));
  try {
    const source = await exportData({ tripId, includeFiles: false });
    const [id] = await importTrips(makeTemplate(source, o));
    return id;
  } catch (e) { throw friendly(e); }
}
