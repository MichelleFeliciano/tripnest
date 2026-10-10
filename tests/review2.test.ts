/** Fixes from the second line-by-line code review. Each test reproduces a problem that existed before the fix. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, transaction } from '../src/api/db';
import { expenses, loadTrip, packing, rows, trash, travelers, trips } from '../src/api/api';
import { eraseEverything, exportData, parseBackup } from '../src/api/backup';
import { PACKING_TEMPLATES } from '../src/lib/packing';
import { MAX_SHARES, SplitError, computeSplits } from '../src/lib/splits';
import { MAX_MINOR_UNITS } from '../src/lib/money';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });

const exp = (paid: string, cents: number) => ({ paid_by: paid, description: 'Cabin', amount_cents: cents, currency: 'USD', expense_date: '2027-06-13', category: 'Lodging', notes: '', itinerary_item_id: '', split_method: 'equal' as const });
async function setup() {
  const t = await trips.create({ name: 'Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me', 'Jon', 'Mom'], ['Ponce']);
  const d = await loadTrip(t.id);
  return { t, me: d.travelers[0].id, jon: d.travelers[1].id, mom: d.travelers[2].id, dest: d.destinations[0].id };
}

describe('trips from older files', () => {
  it('can be edited even when the cover-image field is missing altogether', async () => {
    const { t } = await setup();
    await transaction(['trips'], 'readwrite', async (x) => { const row = await x.get('trips', t.id); delete row!.cover_image_url; await x.putAsIs('trips', row!); });
    await trips.update(t.id, { status: 'archived' }); // used to fail with "Cover image must be an https:// link"
    expect((await loadTrip(t.id)).trip.status).toBe('archived');
  });
  it('refuses a traveler name over 80 characters instead of silently dropping it', async () => {
    await expect(trips.create({ name: 'T', start_date: '2027-06-12', end_date: '2027-06-13' }, ['A'.repeat(81)], [])).rejects.toThrow(/80 characters/);
    expect(await trips.list()).toHaveLength(0);
  });
});

describe('who is "me"', () => {
  it('changing it only touches the travelers that actually change', async () => {
    const { t, me, jon, mom } = await setup();
    const before = Object.fromEntries((await loadTrip(t.id)).travelers.map((x) => [x.id, x.updated_at]));
    await new Promise((r) => setTimeout(r, 5));
    await travelers.setMe(t.id, jon);
    const after = Object.fromEntries((await loadTrip(t.id)).travelers.map((x) => [x.id, x.updated_at]));
    expect(after[me]).not.toBe(before[me]); // was me, no longer
    expect(after[jon]).not.toBe(before[jon]); // is me now
    expect(after[mom]).toBe(before[mom]); // untouched: a merge should not see a change
  });
});

describe('removing a traveler', () => {
  it('goes to Recently deleted with their personal packing list, and Undo brings it all back', async () => {
    const { t, jon, me } = await setup();
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, jon); // Jon's personal list
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], true, me); // shared list
    const shared = (await loadTrip(t.id)).packingItems.find((i) => i.is_shared)!;
    await rows.update('packing_items', shared.id, { assigned_to: jon });
    const personalCount = (await loadTrip(t.id)).packingItems.filter((i) => i.owner_id === jon).length;
    expect(personalCount).toBeGreaterThan(0);

    const gone = await travelers.remove(jon);
    let d = await loadTrip(t.id);
    expect(d.travelers.map((x) => x.name)).toEqual(['Me', 'Mom']);
    expect(d.packingItems.filter((i) => i.owner_id === jon)).toHaveLength(0);
    expect(d.packingItems.find((i) => i.id === shared.id)!.assigned_to).toBeNull();

    await trash.restore(gone.id);
    d = await loadTrip(t.id);
    expect(d.travelers.map((x) => x.name).sort()).toEqual(['Jon', 'Me', 'Mom']);
    expect(d.packingItems.filter((i) => i.owner_id === jon)).toHaveLength(personalCount);
    expect(d.packingItems.find((i) => i.id === shared.id)!.assigned_to).toBe(jon); // the assignment came back too
  });
  it('restoring the traveler who was "me" does not create a second "me"', async () => {
    const { t, me } = await setup();
    const gone = await travelers.remove(me);
    expect((await loadTrip(t.id)).travelers.filter((x) => x.is_me)).toHaveLength(1); // someone else took over
    await trash.restore(gone.id);
    expect((await loadTrip(t.id)).travelers.filter((x) => x.is_me)).toHaveLength(1);
  });
});

describe('restoring only what still makes sense', () => {
  it('will not bring back an expense whose payer was removed in the meantime, until the payer is back', async () => {
    const { t, me, jon } = await setup();
    const id = await expenses.save(t.id, null, exp(jon, 3000), [{ user_id: me, amount_cents: 1500, share_value: null }, { user_id: jon, amount_cents: 1500, share_value: null }]);
    const goneExpense = (await expenses.remove(id))!;
    const goneJon = await travelers.remove(jon); // allowed: nobody's expense mentions Jon any more
    await expect(trash.restore(goneExpense.id)).rejects.toThrow(/Restore them from Recently deleted first/);
    expect((await loadTrip(t.id)).expenses).toHaveLength(0); // and nothing half-restored
    await trash.restore(goneJon.id);
    await trash.restore(goneExpense.id);
    const d = await loadTrip(t.id);
    expect(d.expenses).toHaveLength(1);
    expect(d.travelers.some((x) => x.id === jon)).toBe(true);
  });
  it('will not bring back a payment between people who are no longer on the trip', async () => {
    const { t, me, jon } = await setup();
    const sid = await expenses.settle(t.id, jon, me, 500, 'USD', '2027-06-13', '');
    const goneP = (await expenses.removeSettlement(sid))!;
    await travelers.remove(jon);
    await expect(trash.restore(goneP.id)).rejects.toThrow(/removed from the trip/);
  });
  it('will not create a second budget for a category that has one again', async () => {
    const { t } = await setup();
    const b = await rows.insert<{ id: string }>('budgets', { trip_id: t.id, category: 'Food', amount_cents: 10000, currency: 'USD' });
    const gone = (await rows.remove('budgets', b.id))!;
    await rows.insert('budgets', { trip_id: t.id, category: 'Food', amount_cents: 20000, currency: 'USD' });
    await expect(trash.restore(gone.id)).rejects.toThrow(/budget for that category/);
    expect((await loadTrip(t.id)).budgets).toHaveLength(1);
  });
});

describe('notes go with the thing they are about', () => {
  async function withNotes() {
    const s = await setup();
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: s.t.id, title: 'Tour', local_date: '2027-06-13' });
    await rows.insert('notes', { trip_id: s.t.id, scope: 'itinerary', target_id: item.id, body: 'Bring a hat' });
    await rows.insert('notes', { trip_id: s.t.id, scope: 'destination', target_id: s.dest, body: 'Try the market' });
    await rows.insert('notes', { trip_id: s.t.id, scope: 'trip', target_id: null, body: 'Bring cash' });
    return { ...s, item };
  }
  it('deleting an itinerary item or a destination also removes the notes about it, and Undo restores them together', async () => {
    const s = await withNotes();
    const gone = (await rows.remove('itinerary_items', s.item.id))!;
    expect((await loadTrip(s.t.id)).notes.map((n) => n.body).sort()).toEqual(['Bring cash', 'Try the market']);
    await trash.restore(gone.id);
    expect((await loadTrip(s.t.id)).notes.map((n) => n.body).sort()).toEqual(['Bring a hat', 'Bring cash', 'Try the market']);
    const goneDest = (await rows.remove('destinations', s.dest))!;
    expect((await loadTrip(s.t.id)).notes.map((n) => n.body).sort()).toEqual(['Bring a hat', 'Bring cash']);
    await trash.restore(goneDest.id);
    expect((await loadTrip(s.t.id)).notes).toHaveLength(3);
  });
  it('a trip-wide note is never removed that way', async () => {
    const s = await withNotes();
    await rows.remove('destinations', s.dest);
    await rows.remove('itinerary_items', s.item.id);
    expect((await loadTrip(s.t.id)).notes.map((n) => n.body)).toEqual(['Bring cash']);
  });
  it('a note deleted earlier cannot be restored once what it was about is gone', async () => {
    const s = await withNotes();
    const note = (await loadTrip(s.t.id)).notes.find((n) => n.body === 'Bring a hat')!;
    const goneNote = (await rows.remove('notes', note.id))!;
    await rows.remove('itinerary_items', s.item.id);
    await expect(trash.restore(goneNote.id)).rejects.toThrow(/what the note was about/);
  });
});

describe('files with impossible references are refused', () => {
  async function file() {
    const s = await setup();
    await expenses.save(s.t.id, null, exp(s.me, 3000), [{ user_id: s.me, amount_cents: 1500, share_value: null }, { user_id: s.jon, amount_cents: 1500, share_value: null }]);
    await expenses.settle(s.t.id, s.jon, s.me, 500, 'USD', '2027-06-13', '');
    await packing.applyTemplate(s.t.id, PACKING_TEMPLATES[0], false, s.jon);
    return JSON.parse(JSON.stringify(await exportData({ includeFiles: false })));
  }
  it('a normal file still opens', async () => {
    const f = await file();
    expect(() => parseBackup(JSON.stringify(f))).not.toThrow();
  });
  it('an expense paid by, or split with, someone who is not on the trip', async () => {
    const f = await file();
    const a = structuredClone(f); a.tables.expenses[0].paid_by = 'nobody';
    expect(() => parseBackup(JSON.stringify(a))).toThrow(/not on the trip/);
    const b = structuredClone(f); b.tables.expenses[0].expense_splits[0].user_id = 'nobody';
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/not on the trip/);
  });
  it('a payment, a packing list or a packing item that points at someone, or something, that is not there', async () => {
    const f = await file();
    const a = structuredClone(f); a.tables.settlements[0].to_user = 'nobody';
    expect(() => parseBackup(JSON.stringify(a))).toThrow(/payment/);
    const b = structuredClone(f); b.tables.packing_categories[0].owner_id = 'nobody';
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/packing list/);
    const c = structuredClone(f); c.tables.packing_items[0].category_id = 'nowhere';
    expect(() => parseBackup(JSON.stringify(c))).toThrow(/not in any category/);
    const d = structuredClone(f); d.tables.packing_items[0].owner_id = 'nobody';
    expect(() => parseBackup(JSON.stringify(d))).toThrow(/packing item/);
  });
  it('a traveler of another trip does not count', async () => {
    const f = await file();
    f.tables.trips.push({ ...f.tables.trips[0], id: 'other-trip' });
    f.tables.travelers.push({ id: 'stranger', trip_id: 'other-trip', name: 'Stranger', is_me: true, sort_order: 0 });
    f.tables.expenses[0].paid_by = 'stranger';
    expect(() => parseBackup(JSON.stringify(f))).toThrow(/not on the trip/);
  });
});

describe('erasing everything', () => {
  it('also clears saved weather and Explore results, notes about this device, and drafts', async () => {
    const mk = () => { const m = new Map<string, string>(); return { m, store: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, clear: () => m.clear() } }; };
    const local = mk(); const session = mk();
    // Object.keys() on a storage lists its keys; mimic that with a proxy over the map
    const asStorage = (s: ReturnType<typeof mk>) => new Proxy(s.store, { ownKeys: () => [...s.m.keys()], getOwnPropertyDescriptor: (_t, k) => (s.m.has(String(k)) ? { enumerable: true, configurable: true, value: s.m.get(String(k)) } : undefined) });
    local.m.set('tripnest:settings', '{}'); local.m.set('tripnest:device', '{"weather_on":true}');
    local.m.set('tripnest:weather:v1:https://api.open-meteo.com/v1/forecast?latitude=18.4655&longitude=-66.1057', '{}');
    local.m.set('tripnest:explore:v3:sights:18.47:-66.11:10', '{}'); local.m.set('someone-elses-key', 'keep');
    session.m.set('tripnest:draft:new-trip', '{}');
    vi.stubGlobal('window', { localStorage: asStorage(local), sessionStorage: asStorage(session) });
    try {
      await setup();
      await eraseEverything();
      expect([...local.m.keys()]).toEqual(['someone-elses-key']); // only TripNest's own keys go
      expect(session.m.size).toBe(0);
      expect(await trips.list()).toHaveLength(0);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('splitting by shares stays exact', () => {
  it('refuses a share count that could overflow the arithmetic, with a clear message', () => {
    expect(() => computeSplits(1000, 'shares', [{ userId: 'a', value: MAX_SHARES + 1 }, { userId: 'b', value: 1 }])).toThrow(/at most 10,000/);
    expect(() => computeSplits(1000, 'shares', [{ userId: 'a', value: 9_007_199_254_740_991 }, { userId: 'b', value: 1 }])).toThrow(SplitError);
  });
  it('adds up exactly even at the largest total and the largest shares', () => {
    for (const values of [[MAX_SHARES, MAX_SHARES], [MAX_SHARES, 1], [9_999, 7, 3], [1, 1, 1]]) {
      const parts = computeSplits(MAX_MINOR_UNITS, 'shares', values.map((value, i) => ({ userId: `u${i}`, value })));
      expect(parts.reduce((n, p) => n + p.amountCents, 0)).toBe(MAX_MINOR_UNITS);
    }
  });
});
