/** Regression tests for problems found during the code review. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../src/api/db';
import { documents, expenses, packing, rows, trips } from '../src/api/api';
import { exportData, importTrips, parseBackup } from '../src/api/backup';
import { PACKING_TEMPLATES } from '../src/lib/packing';
import { uuid } from '../src/lib/uuid';
import { defaultZone } from '../src/api/adapters';
import { browserTimeZone } from '../src/lib/time';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('uuid works without crypto.randomUUID (plain http contexts)', () => {
  it('produces valid, unique v4 ids using getRandomValues alone', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = Array.from({ length: 500 }, () => uuid());
    expect(new Set(ids).size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('uses the native one when available', () => {
    expect(uuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('damaged or hand-edited backups are refused instead of crashing a screen later', () => {
  async function goodFile() {
    const t = await trips.create({ name: 'Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me', 'Jon'], ['Ponce']);
    const d = (await exportData({ includeFiles: false })).tables;
    const [me, jon] = d.travelers.map((x) => x.id);
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12', start_at: '2027-06-12T13:00:00Z', start_tz: 'America/Chicago', cost_cents: 100, currency: 'USD' });
    await rows.insert('reservations', { trip_id: t.id, kind: 'hotel', title: 'Hotel', starts_at: '2027-06-12T20:00:00Z', starts_tz: 'UTC', itinerary_item_id: item.id });
    await expenses.save(t.id, null, { paid_by: me, description: 'x', amount_cents: 100, currency: 'USD', expense_date: '2027-06-13', category: 'Food', notes: '', itinerary_item_id: '', split_method: 'equal' }, [{ user_id: me, amount_cents: 50, share_value: null }, { user_id: jon, amount_cents: 50, share_value: null }]);
    await expenses.settle(t.id, jon, me, 10, 'USD', '2027-06-14', '');
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], true, me);
    await rows.insert('budgets', { trip_id: t.id, category: 'Food', amount_cents: 500, currency: 'USD' });
    await rows.insert('notes', { trip_id: t.id, scope: 'trip', body: 'hi' });
    return JSON.parse(JSON.stringify(await exportData({ includeFiles: false })));
  }
  const cases: [string, (b: any) => void, RegExp][] = [
    ['itinerary time that is not a date', (b) => { b.tables.itinerary_items[0].start_at = 'garbage'; }, /not a real date/],
    ['itinerary cost without a currency', (b) => { b.tables.itinerary_items[0].currency = null; }, /invalid cost/],
    ['reservation with an unknown kind', (b) => { b.tables.reservations[0].kind = 'spaceship'; }, /reservation/],
    ['reservation time that is not a date', (b) => { b.tables.reservations[0].starts_at = 'soon'; }, /reservation/],
    ['expense with a bad date', (b) => { b.tables.expenses[0].expense_date = 'yesterday'; }, /expense/],
    ['expense with an unknown category', (b) => { b.tables.expenses[0].category = 'Yachts'; }, /expense/],
    ['expense with an unknown split method', (b) => { b.tables.expenses[0].split_method = 'vibes'; }, /expense/],
    ['payment with a bad date', (b) => { b.tables.settlements[0].settled_on = 'never'; }, /payment/],
    ['trip with an unknown status', (b) => { b.tables.trips[0].status = 'vacationing'; }, /not recognised/],
    ['trip with a broken currency', (b) => { b.tables.trips[0].default_currency = 'dollars'; }, /not recognised/],
    ['packing item with zero quantity', (b) => { b.tables.packing_items[0].quantity = 0; }, /packing item/],
    ['packing item with a non-boolean flag', (b) => { b.tables.packing_items[0].packed = 'yes'; }, /packing item/],
    ['budget in an unknown category', (b) => { b.tables.budgets[0].category = 'Yachts'; }, /budget/],
    ['destination with impossible coordinates', (b) => { b.tables.destinations[0].latitude = 500; }, /destination/],
    ['destination with a bad date', (b) => { b.tables.destinations[0].arrival_date = 'x'; }, /destination/],
    ['traveler without a name', (b) => { b.tables.travelers[0].name = 5; }, /traveler/],
    ['note with an unknown scope', (b) => { b.tables.notes[0].scope = 'secret'; }, /note/],
  ];
  for (const [name, tamper, message] of cases) {
    it(`refuses: ${name}`, async () => {
      const f = await goodFile();
      expect(() => parseBackup(JSON.stringify(f))).not.toThrow(); // the untouched file is fine
      tamper(f);
      expect(() => parseBackup(JSON.stringify(f))).toThrow(message);
    });
  }
  it('a trip file that passes validation imports cleanly', async () => {
    const f = await goodFile();
    const ids = await importTrips(parseBackup(JSON.stringify(f)));
    expect(ids).toHaveLength(1);
  });
});

describe('records without optional bookkeeping fields (older or hand-edited files)', () => {
  it('imports and loads without crashing when created_at and sort_order are missing', async () => {
    const t = await trips.create({ name: 'Bare', start_date: '2027-06-12', end_date: '2027-06-13' }, ['Me', 'Jon'], ['Ponce']);
    const [me, jon] = (await exportData({ includeFiles: false })).tables.travelers.map((x) => x.id);
    await expenses.save(t.id, null, { paid_by: me, description: 'x', amount_cents: 100, currency: 'USD', expense_date: '2027-06-13', category: 'Food', notes: '', itinerary_item_id: '', split_method: 'equal' }, [{ user_id: me, amount_cents: 50, share_value: null }, { user_id: jon, amount_cents: 50, share_value: null }]);
    await expenses.settle(t.id, jon, me, 10, 'USD', '2027-06-14', '');
    await rows.insert('notes', { trip_id: t.id, scope: 'trip', body: 'hi' });
    await documents.upload(t.id, new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }), {});
    const raw = JSON.parse(JSON.stringify(await exportData({ includeFiles: false })));
    for (const table of Object.values(raw.tables) as Record<string, unknown>[][]) for (const row of table) { delete row.created_at; delete row.sort_order; }
    const [id] = await importTrips(parseBackup(JSON.stringify(raw)));
    expect((await trips.list()).map((x) => x.name).sort()).toEqual(['Bare', 'Bare (copy)']);
    const { loadTrip } = await import('../src/api/api');
    const d = await loadTrip(id);
    expect(d.expenses).toHaveLength(1);
    expect(d.settlements).toHaveLength(1);
    expect(d.notes).toHaveLength(1);
    expect(d.documents).toHaveLength(1);
    expect(d.travelers).toHaveLength(2);
  });
});

describe('default time zone for a new item', () => {
  const item = (id: string, tz: string | null, touched: string, field: 'created_at' | 'updated_at' = 'created_at') =>
    ({ id, start_tz: tz, [field]: touched }) as unknown as import('../src/api/types').ItineraryRow;
  it('follows the most recently touched item, not an arbitrary one', () => {
    const items = [item('a', 'America/Chicago', '2027-01-01T00:00:00Z'), item('b', 'America/Puerto_Rico', '2027-01-02T00:00:00Z'), item('c', null, '2027-01-03T00:00:00Z')];
    expect(defaultZone(items)).toBe('America/Puerto_Rico'); // c has no zone; b is the latest that does
    expect(defaultZone([...items].reverse())).toBe('America/Puerto_Rico'); // order of the list does not matter
    items.push(item('d', 'Europe/Madrid', '2027-01-01T00:00:00Z', 'updated_at')); // edited earlier than b was created
    expect(defaultZone(items)).toBe('America/Puerto_Rico');
    items.push(item('e', 'Asia/Tokyo', '2027-02-01T00:00:00Z', 'updated_at')); // edited most recently
    expect(defaultZone(items)).toBe('Asia/Tokyo');
  });
  it('falls back to the device zone when no item has one', () => {
    expect(defaultZone([])).toBe(browserTimeZone());
    expect(defaultZone([item('x', null, '2027-01-01')])).toBe(browserTimeZone());
  });
});

describe('backing up several documents', () => {
  it('includes every file', async () => {
    const t = await trips.create({ name: 'Docs', start_date: '2027-06-12', end_date: '2027-06-13' }, ['A'], []);
    for (const n of ['a.pdf', 'b.pdf', 'c.pdf']) await documents.upload(t.id, new File([new Uint8Array(1000)], n, { type: 'application/pdf' }), {});
    const f = await exportData({ includeFiles: true });
    expect(Object.keys(f.files)).toHaveLength(3);
  });
});
