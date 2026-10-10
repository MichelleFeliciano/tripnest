/** Merging two copies of a trip: newest wins, deletions travel, "me" stays put, nothing dangles, and two phones end up identical. */
import { describe, expect, it } from 'vitest';
import { emptyRows, mergeTrip, type MergeInput, type RowsByTable, type Tombstone } from '../src/lib/merge';
import type { Row, Table } from '../src/api/db';

const T = 'trip-1';
const at = (n: number) => new Date(Date.UTC(2027, 0, 1, 0, 0, n)).toISOString(); // n seconds after a fixed start
const rows = (o: Partial<Record<Table, Row[]>>): RowsByTable => ({ ...emptyRows(), ...o });
const trip = (n: number, extra: Record<string, unknown> = {}): Row => ({ id: T, name: 'Trip', updated_at: at(n), ...extra });
const item = (id: string, n: number | null, extra: Record<string, unknown> = {}): Row => ({ id, trip_id: T, title: id, ...(n === null ? {} : { updated_at: at(n) }), ...extra });
const tomb = (table: Table, id: string, n: number): Tombstone => ({ table, id, deleted_at: at(n) });
const merge = (local: RowsByTable, incoming: RowsByTable, o: Partial<MergeInput> = {}) =>
  mergeTrip({ tripId: T, local, incoming, incomingTombstones: [], localTombstones: [], now: at(1000), ...o });
const ids = (r: ReturnType<typeof merge>, table: Table = 'itinerary_items') => r.puts.filter((p) => p.table === table).map((p) => p.row.id).sort();

describe('which version of a row wins', () => {
  const base = rows({ trips: [trip(1)] });
  it('takes the other side when it is clearly newer, and keeps ours when ours is newer', () => {
    const newer = merge({ ...base, itinerary_items: [item('a', 5, { title: 'mine' })] }, { ...base, itinerary_items: [item('a', 9, { title: 'theirs' })] });
    expect(newer.puts.find((p) => p.row.id === 'a')!.row.title).toBe('theirs');
    expect(newer.summary).toMatchObject({ added: 0, updated: 1, removed: 0 });
    const older = merge({ ...base, itinerary_items: [item('a', 9, { title: 'mine' })] }, { ...base, itinerary_items: [item('a', 5, { title: 'theirs' })] });
    expect(older.puts).toEqual([]);
    expect(older.summary).toMatchObject({ added: 0, updated: 0, removed: 0 });
  });
  it('keeps ours on a tie, and when the other side has no stamp (never change anything on a guess)', () => {
    for (const [a, b] of [[5, 5], [5, null], [null, null]] as const) {
      const r = merge({ ...base, itinerary_items: [item('a', a, { title: 'mine' })] }, { ...base, itinerary_items: [item('a', b, { title: 'theirs' })] });
      expect(r.puts, `${a} vs ${b}`).toEqual([]);
    }
    // a row of ours with no stamp is the oldest thing there is, so any stamped version from the other side wins
    const r = merge({ ...base, itinerary_items: [item('a', null, { title: 'mine' })] }, { ...base, itinerary_items: [item('a', 9, { title: 'theirs' })] });
    expect(r.puts[0].row.title).toBe('theirs');
  });
  it('treats a garbage stamp as "no stamp"', () => {
    const r = merge({ ...base, itinerary_items: [item('a', 5, { title: 'mine' })] }, { ...base, itinerary_items: [item('a', null, { title: 'theirs', updated_at: 'not a date' })] });
    expect(r.puts).toEqual([]);
  });
  it('adds rows only the other side has, and leaves rows only we have alone', () => {
    const r = merge({ ...base, itinerary_items: [item('mine', 5)] }, { ...base, itinerary_items: [item('theirs', 6)] });
    expect(ids(r)).toEqual(['theirs']);
    expect(r.summary).toMatchObject({ added: 1, updated: 0, removed: 0 });
    expect(r.summary.byTable.itinerary_items).toEqual({ added: 1, updated: 0, removed: 0 });
  });
  it('takes the trip details from whichever side changed them last', () => {
    const r = merge(rows({ trips: [trip(3, { name: 'Old' })] }), rows({ trips: [trip(8, { name: 'New' })] }));
    expect(r.puts[0].row.name).toBe('New');
  });
  it('never takes a row that belongs to a different trip', () => {
    const r = merge(base, { ...base, itinerary_items: [item('x', 9, { trip_id: 'other-trip' })], trips: [trip(1), { id: 'other-trip', updated_at: at(9) }] });
    expect(r.puts).toEqual([]);
  });
});

describe('deletions', () => {
  const base = rows({ trips: [trip(1)] });
  it('a deletion we made stays deleted unless the other side changed the row after it', () => {
    const stays = merge(base, { ...base, itinerary_items: [item('a', 4)] }, { localTombstones: [tomb('itinerary_items', 'a', 6)] });
    expect(stays.puts).toEqual([]);
    const back = merge(base, { ...base, itinerary_items: [item('a', 8)] }, { localTombstones: [tomb('itinerary_items', 'a', 6)] });
    expect(ids(back)).toEqual(['a']); // edited after we deleted it: it returns
  });
  it('a deletion the other side recorded removes the row here, unless we changed it after', () => {
    const removed = merge({ ...base, itinerary_items: [item('a', 4)] }, base, { incomingTombstones: [tomb('itinerary_items', 'a', 6)] });
    expect(removed.removes.map((r) => r.row.id)).toEqual(['a']);
    expect(removed.summary).toMatchObject({ added: 0, updated: 0, removed: 1 });
    const kept = merge({ ...base, itinerary_items: [item('a', 9)] }, base, { incomingTombstones: [tomb('itinerary_items', 'a', 6)] });
    expect(kept.removes).toEqual([]);
  });
  it('a row that arrives already deleted is never added then removed', () => {
    const r = merge(base, { ...base, itinerary_items: [item('a', 4)] }, { incomingTombstones: [tomb('itinerary_items', 'a', 6)] });
    expect(r.puts).toEqual([]);
    expect(r.removes).toEqual([]);
    expect(r.summary).toMatchObject({ added: 0, updated: 0, removed: 0 });
  });
  it('ignores a recorded deletion of the trip itself', () => {
    const r = merge(base, base, { incomingTombstones: [tomb('trips', T, 9)] });
    expect(r.removes).toEqual([]);
  });
});

describe('travelers', () => {
  const me = { id: 'me', trip_id: T, name: 'Michelle', is_me: true, updated_at: at(1) };
  const jon = { id: 'jon', trip_id: T, name: 'Jon', is_me: false, updated_at: at(1) };
  const base = rows({ trips: [trip(1)] });
  it('never changes who "me" is on this device, even when a traveler row is updated', () => {
    const r = merge({ ...base, travelers: [me, jon] }, { ...base, travelers: [{ ...me, name: 'Mish', is_me: false, updated_at: at(9) }, { ...jon, is_me: true, updated_at: at(2) }] });
    const row = r.puts.find((p) => p.row.id === 'me')!.row;
    expect([row.name, row.is_me]).toEqual(['Mish', true]);
    expect(r.puts.find((p) => p.row.id === 'jon')!.row.is_me).toBe(false);
  });
  it('a traveler arriving from the other side is never "me" here', () => {
    const r = merge({ ...base, travelers: [me] }, { ...base, travelers: [{ id: 'mom', trip_id: T, name: 'Mom', is_me: true, updated_at: at(2) }] });
    expect(r.puts.find((p) => p.row.id === 'mom')!.row.is_me).toBe(false);
  });
  it('a traveler stays while an expense still refers to them, whatever was deleted elsewhere', () => {
    const exp = { id: 'e1', trip_id: T, paid_by: 'jon', expense_splits: [{ user_id: 'me', amount_cents: 1 }], updated_at: at(5) };
    const r = merge({ ...base, travelers: [me, jon], expenses: [exp] }, { ...base, travelers: [me] }, { incomingTombstones: [tomb('travelers', 'jon', 9)] });
    expect(r.removes).toEqual([]);
    const back = merge({ ...base, travelers: [me] }, { ...base, travelers: [me, jon], expenses: [exp] }, { localTombstones: [tomb('travelers', 'jon', 9)] });
    expect(back.puts.map((p) => p.row.id).sort()).toEqual(['e1', 'jon']); // we had removed Jon, but the incoming expense needs him
  });
  it('removes an unreferenced traveler the other side removed', () => {
    const r = merge({ ...base, travelers: [me, jon] }, { ...base, travelers: [me] }, { incomingTombstones: [tomb('travelers', 'jon', 9)] });
    expect(r.removes.map((x) => x.row.id)).toEqual(['jon']);
  });
});

describe('nothing is left pointing at something that is gone', () => {
  const base = rows({ trips: [trip(1)] });
  const dest = { id: 'd1', trip_id: T, updated_at: at(1) };
  it('clears soft links when the target was deleted on the other side', () => {
    const local = rows({
      trips: [trip(1)], destinations: [dest], itinerary_items: [item('i1', 1, { destination_id: 'd1' }), item('i2', 1, { destination_id: null })],
      reservations: [{ id: 'r1', trip_id: T, itinerary_item_id: 'i1', updated_at: at(1) }],
      expenses: [{ id: 'e1', trip_id: T, itinerary_item_id: 'i1', paid_by: 'p', expense_splits: [], updated_at: at(1) }],
      documents: [{ id: 'doc1', trip_id: T, itinerary_item_id: 'i1', reservation_id: 'r1', updated_at: at(1) }],
    });
    const r = merge(local, base, { incomingTombstones: [tomb('itinerary_items', 'i1', 9), tomb('destinations', 'd1', 9)] });
    expect(r.removes.map((x) => x.row.id).sort()).toEqual(['d1', 'i1']);
    const get = (id: string) => r.puts.find((p) => p.row.id === id)!.row;
    expect(get('r1').itinerary_item_id).toBeNull();
    expect(get('e1').itinerary_item_id).toBeNull();
    expect(get('doc1').itinerary_item_id).toBeNull();
    expect(get('doc1').reservation_id).toBe('r1'); // that one still exists
    expect(get('r1').updated_at).toBe(at(1000)); // the repair counts as a change, so it travels onward
  });
  it('drops packing items whose category went, and notes about things that went', () => {
    const local = rows({
      trips: [trip(1)], packing_categories: [{ id: 'c1', trip_id: T, updated_at: at(1) }], packing_items: [{ id: 'p1', trip_id: T, category_id: 'c1', updated_at: at(1) }],
      itinerary_items: [item('i1', 1)], notes: [{ id: 'n1', trip_id: T, scope: 'itinerary', target_id: 'i1', updated_at: at(1) }, { id: 'n2', trip_id: T, scope: 'trip', target_id: null, updated_at: at(1) }],
    });
    const r = merge(local, base, { incomingTombstones: [tomb('packing_categories', 'c1', 9), tomb('itinerary_items', 'i1', 9)] });
    expect(r.removes.map((x) => x.row.id).sort()).toEqual(['c1', 'i1', 'n1', 'p1']);
    expect(r.removes.some((x) => x.row.id === 'n2')).toBe(false); // a trip-wide note stays
  });
  it('a row arriving that points at something we deleted loses the link instead of dangling', () => {
    const r = merge(base, { ...base, itinerary_items: [item('i1', 5, { destination_id: 'gone' })] });
    expect(r.puts.find((p) => p.row.id === 'i1')!.row.destination_id).toBeNull();
  });
});

describe('repeating a merge', () => {
  it('changes nothing the second time', () => {
    const local = rows({ trips: [trip(1)], itinerary_items: [item('a', 2), item('b', 3)] });
    const incoming = rows({ trips: [trip(4)], itinerary_items: [item('a', 9, { title: 'A2' }), item('c', 5)] });
    const tombs = [tomb('itinerary_items', 'b', 7)];
    const first = merge(local, incoming, { incomingTombstones: tombs });
    const after = rows({ trips: [trip(4)], itinerary_items: [first.puts.find((p) => p.row.id === 'a')!.row, first.puts.find((p) => p.row.id === 'c')!.row] });
    const second = merge(after, incoming, { incomingTombstones: tombs });
    expect(second.puts).toEqual([]);
    expect(second.removes).toEqual([]);
  });
});

/** Two phones that both edit, add and delete, then swap files, must end up with the same trip. */
describe('two phones converge', () => {
  function seeded(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  interface Phone { rows: Map<string, Row>; tombs: Tombstone[] }
  const view = (p: Phone): RowsByTable => rows({ trips: [trip(1)], itinerary_items: [...p.rows.values()] });
  const apply = (p: Phone, r: ReturnType<typeof merge>) => {
    for (const x of r.puts) p.rows.set(x.row.id, x.row);
    for (const x of r.removes) { p.rows.delete(x.row.id); p.tombs.push(tomb('itinerary_items', x.row.id, 0)); }
  };

  it('over many random histories', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = seeded(seed);
      let clock = 10;
      const a: Phone = { rows: new Map(), tombs: [] };
      const b: Phone = { rows: new Map(), tombs: [] };
      for (let i = 0; i < 4; i++) { const r = item(`s${i}`, ++clock, { v: 0 }); a.rows.set(r.id, r); b.rows.set(r.id, r); } // a shared starting point
      let fresh = 0;
      for (let step = 0; step < 14; step++) {
        const p = rnd() < 0.5 ? a : b;
        const have = [...p.rows.keys()];
        const roll = rnd();
        if (roll < 0.35 || have.length === 0) { const id = `n${fresh++}${p === a ? 'a' : 'b'}`; p.rows.set(id, item(id, ++clock, { v: clock })); }
        else if (roll < 0.75) { const id = have[Math.floor(rnd() * have.length)]; p.rows.set(id, { ...p.rows.get(id)!, v: ++clock, updated_at: at(clock) }); }
        else { const id = have[Math.floor(rnd() * have.length)]; p.rows.delete(id); p.tombs.push(tomb('itinerary_items', id, ++clock)); }
      }
      const fileA = { rows: view(a), tombs: [...a.tombs] };
      const fileB = { rows: view(b), tombs: [...b.tombs] };
      const ra = merge(view(a), fileB.rows, { incomingTombstones: fileB.tombs, localTombstones: a.tombs });
      const rb = merge(view(b), fileA.rows, { incomingTombstones: fileA.tombs, localTombstones: b.tombs });
      apply(a, ra); apply(b, rb);
      const dump = (p: Phone) => JSON.stringify([...p.rows.values()].sort((x, y) => x.id.localeCompare(y.id)));
      expect(dump(a), `seed ${seed}`).toBe(dump(b));
    }
  });
});
