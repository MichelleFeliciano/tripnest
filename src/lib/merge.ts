/**
 * Merging two copies of the same trip (for example yours and one a travel companion edited and sent back).
 * Pure: it works on plain rows and returns what to write and what to remove; src/api/merge.ts does the storing.
 *
 * Rules (each one is tested):
 *  - Every row carries an `updated_at` stamp. For a row that exists on both sides, the NEWER one wins. Ties and rows
 *    without a stamp keep what this device already has, so a merge never changes anything unless the other side is clearly newer.
 *  - A row only the other side has is added, unless this device deleted it more recently than the other side changed it.
 *  - A deletion recorded in the other side's file ("tombstone") removes the row here, unless this device changed it more recently.
 *  - Which traveler is "me" belongs to this device and is never changed by a merge.
 *  - A traveler is never removed while anything still refers to them (an expense, a payment, a packing list, an assignment).
 *  - Afterwards, links to things that no longer exist are cleared (or the dependent row is dropped), the same way a normal delete does.
 */
import type { Row, Table } from '../api/db';
import { TABLES } from '../api/db';

export type RowsByTable = Record<Table, Row[]>;
export interface Tombstone { table: Table; id: string; deleted_at: string }

export interface MergeInput {
  tripId: string;
  local: RowsByTable;
  incoming: RowsByTable;
  incomingTombstones: Tombstone[];
  /** What this device deleted recently (from Recently deleted). */
  localTombstones: Tombstone[];
  /** Used to stamp rows the repair step changes. */
  now: string;
}

export interface MergeResult {
  puts: { table: Table; row: Row }[];
  removes: { table: Table; row: Row }[];
  summary: MergeSummary;
}
export interface MergeSummary {
  added: number;
  updated: number;
  removed: number;
  /** Per table, for the preview: e.g. { itinerary_items: { added: 2, updated: 1, removed: 0 } } */
  byTable: Partial<Record<Table, { added: number; updated: number; removed: number }>>;
}

const stampOf = (row: Row | undefined): number => {
  const n = row?.updated_at ? Date.parse(String(row.updated_at)) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const dateOf = (s: string): number => { const n = Date.parse(s); return Number.isFinite(n) ? n : 0; };

/** Links that may be cleared when their target is gone: [table, field, target table]. */
const SOFT_LINKS: [Table, string, Table][] = [
  ['itinerary_items', 'destination_id', 'destinations'],
  ['reservations', 'itinerary_item_id', 'itinerary_items'],
  ['expenses', 'itinerary_item_id', 'itinerary_items'],
  ['documents', 'itinerary_item_id', 'itinerary_items'],
  ['documents', 'reservation_id', 'reservations'],
  ['packing_items', 'assigned_to', 'travelers'],
];
/** Rows that cannot exist without their parent: [table, field, parent table]. */
const HARD_LINKS: [Table, string, Table][] = [
  ['packing_items', 'category_id', 'packing_categories'],
  ['packing_categories', 'owner_id', 'travelers'], // only when owner_id is set
];

export function emptyRows(): RowsByTable {
  return Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as RowsByTable;
}

/** Traveler ids that something on either side still refers to. */
function referencedTravelers(...sets: RowsByTable[]): Set<string> {
  const ids = new Set<string>();
  for (const rows of sets) {
    for (const e of rows.expenses) { ids.add(e.paid_by); for (const s of e.expense_splits ?? []) ids.add(s.user_id); }
    for (const s of rows.settlements) { ids.add(s.from_user); ids.add(s.to_user); }
    for (const c of rows.packing_categories) if (c.owner_id) ids.add(c.owner_id);
    for (const p of rows.packing_items) { if (p.assigned_to) ids.add(p.assigned_to); if (p.owner_id) ids.add(p.owner_id); }
  }
  return ids;
}

export function mergeTrip(input: MergeInput): MergeResult {
  const { tripId, local, incoming, incomingTombstones, localTombstones, now } = input;
  const nowStamp = dateOf(now);
  const localTomb = new Map(localTombstones.map((t) => [`${t.table}:${t.id}`, dateOf(t.deleted_at)]));
  const stillNeeded = referencedTravelers(local, incoming);

  // The merged view, built table by table. `final` holds every row that will exist afterwards.
  const final = emptyRows();
  const added = new Set<string>(); const updated = new Set<string>();
  const key = (t: Table, id: string) => `${t}:${id}`;

  for (const t of TABLES) {
    const localById = new Map(local[t].map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const inc of incoming[t]) {
      if (t === 'trips' ? inc.id !== tripId : inc.trip_id !== tripId) continue; // never take rows belonging to another trip
      seen.add(inc.id);
      const mine = localById.get(inc.id);
      if (!mine) {
        const deletedHere = localTomb.get(key(t, inc.id));
        const keepDeleted = deletedHere !== undefined && deletedHere >= stampOf(inc) && !(t === 'travelers' && stillNeeded.has(inc.id));
        if (keepDeleted) continue;
        final[t].push(t === 'travelers' ? { ...inc, is_me: false } : inc); // "me" is decided per device
        added.add(key(t, inc.id));
      } else if (stampOf(inc) > stampOf(mine)) {
        final[t].push(t === 'travelers' ? { ...inc, is_me: mine.is_me } : inc);
        updated.add(key(t, inc.id));
      } else {
        final[t].push(mine);
      }
    }
    for (const mine of local[t]) if (!seen.has(mine.id)) final[t].push(mine);
  }

  // Deletions the other side recorded.
  const removed = new Map<string, { table: Table; row: Row }>();
  for (const tomb of incomingTombstones) {
    if (tomb.table === 'trips') continue;
    const row = final[tomb.table].find((r) => r.id === tomb.id);
    if (!row || dateOf(tomb.deleted_at) <= stampOf(row)) continue; // changed more recently than it was deleted: keep it
    if (tomb.table === 'travelers' && stillNeeded.has(row.id)) continue;
    final[tomb.table] = final[tomb.table].filter((r) => r.id !== tomb.id);
    added.delete(key(tomb.table, tomb.id)); updated.delete(key(tomb.table, tomb.id));
    removed.set(key(tomb.table, tomb.id), { table: tomb.table, row: local[tomb.table].find((r) => r.id === tomb.id) ?? row });
  }

  // Repair: a link to something that is gone is cleared; a row that cannot live without its parent goes too.
  const touched = new Set<string>();
  const exists = (t: Table, id: unknown) => typeof id === 'string' && final[t].some((r) => r.id === id);
  for (let changed = true; changed;) {
    changed = false;
    for (const [t, field, target] of SOFT_LINKS) {
      final[t] = final[t].map((r) => {
        if (r[field] && !exists(target, r[field])) { changed = true; touched.add(key(t, r.id)); return { ...r, [field]: null, updated_at: now }; }
        return r;
      });
    }
    for (const [t, field, parent] of HARD_LINKS) {
      for (const r of [...final[t]]) {
        if (r[field] && !exists(parent, r[field])) {
          final[t] = final[t].filter((x) => x.id !== r.id);
          if (local[t].some((x) => x.id === r.id)) removed.set(key(t, r.id), { table: t, row: local[t].find((x) => x.id === r.id)! });
          added.delete(key(t, r.id)); updated.delete(key(t, r.id)); touched.delete(key(t, r.id));
          changed = true;
        }
      }
    }
    // Notes about something that no longer exists
    const noteTarget: Record<string, Table> = { destination: 'destinations', itinerary: 'itinerary_items', reservation: 'reservations' };
    for (const n of [...final.notes]) {
      const target = noteTarget[n.scope];
      if (target && !exists(target, n.target_id)) {
        final.notes = final.notes.filter((x) => x.id !== n.id);
        if (local.notes.some((x) => x.id === n.id)) removed.set(key('notes', n.id), { table: 'notes', row: local.notes.find((x) => x.id === n.id)! });
        added.delete(key('notes', n.id)); updated.delete(key('notes', n.id)); touched.delete(key('notes', n.id));
        changed = true;
      }
    }
  }
  void nowStamp;

  // What actually differs from this device right now.
  const puts: MergeResult['puts'] = [];
  const byTable: MergeSummary['byTable'] = {};
  const bump = (t: Table, what: 'added' | 'updated' | 'removed') => { const e = (byTable[t] ??= { added: 0, updated: 0, removed: 0 }); e[what]++; };
  for (const t of TABLES) {
    const localById = new Map(local[t].map((r) => [r.id, r]));
    for (const r of final[t]) {
      const mine = localById.get(r.id);
      if (!mine) { puts.push({ table: t, row: r }); bump(t, 'added'); }
      else if (mine !== r) { puts.push({ table: t, row: r }); if (!touched.has(key(t, r.id)) || updated.has(key(t, r.id))) bump(t, 'updated'); }
    }
  }
  const removes = [...removed.values()].filter(({ table, row }) => local[table].some((r) => r.id === row.id));
  for (const r of removes) bump(r.table, 'removed');
  const sum = (w: 'added' | 'updated' | 'removed') => Object.values(byTable).reduce((n, e) => n + (e?.[w] ?? 0), 0);
  return { puts, removes, summary: { added: sum('added'), updated: sum('updated'), removed: sum('removed'), byTable } };
}
