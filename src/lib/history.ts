import type { Row, Table } from '../api/db';

const NOUN: Record<Table, string> = {
  trips: 'trip', travelers: 'traveler', destinations: 'destination', itinerary_items: 'itinerary item', reservations: 'reservation',
  packing_categories: 'packing category', packing_items: 'packing item', expenses: 'expense', settlements: 'payment', budgets: 'budget',
  notes: 'note', documents: 'document', tasks: 'to-do',
};
export const nounFor = (t: Table) => NOUN[t] ?? t;

/** A short name for a row, for the History list. */
export function rowName(table: Table, row: Row | null): string {
  if (!row) return '';
  if (table === 'budgets') return String(row.category ?? '');
  if (table === 'notes') return String(row.body ?? '').slice(0, 40);
  if (table === 'settlements') return '';
  const v = row.name ?? row.title ?? row.description ?? row.file_name ?? '';
  return String(v).slice(0, 60);
}

/** "Added expense “Dinner”", "Edited trip “Rome”"… `others` is how many more rows changed in the same step. */
export function describeChange(table: Table, before: Row | null, after: Row | null, others = 0): string {
  const name = rowName(table, after ?? before);
  const base = `${before ? 'Edited' : 'Added'} ${nounFor(table)}${name ? ` “${name}”` : ''}`;
  return others > 0 ? `${base} (+${others} related)` : base;
}

const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)])) : v);
/** Same row ignoring the save stamp? Used to skip no-op saves and to refuse an undo of something changed since. */
export function sameContent(a: Row | null | undefined, b: Row | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const strip = ({ updated_at: _u, ...rest }: Row) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
  return JSON.stringify(stable(strip(a))) === JSON.stringify(stable(strip(b)));
}
