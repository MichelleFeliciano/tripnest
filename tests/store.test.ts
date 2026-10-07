/**
 * The on-device data layer. These tests replace the old database-level security tests: they prove the
 * rules the database used to enforce (balanced splits, valid money, cascades, same-trip references,
 * safe imports) now hold in the app itself.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/api/db';
import { documents, expenses, loadTrip, packing, rows, travelers, trips } from '../src/api/api';
import { backupFileName, exportData, eraseEverything, importTrips, parseBackup, restoreAll } from '../src/api/backup';
import { computeNetBalances, suggestSettlements } from '../src/lib/balances';
import { computeSplits } from '../src/lib/splits';
import { PACKING_TEMPLATES } from '../src/lib/packing';
import { expenseLike, settlementLike } from '../src/api/adapters';

beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const base = { name: 'Puerto Rico', start_date: '2027-06-12', end_date: '2027-06-19' };
async function makeTrip(names = ['Michelle', 'Jon', 'Sam']) {
  const t = await trips.create(base, names, ['Ponce']);
  return { t, d: await loadTrip(t.id) };
}
const exp = (paid: string, cents: number) => ({ paid_by: paid, description: 'Dinner', amount_cents: cents, currency: 'USD', expense_date: '2027-06-13', category: 'Food', notes: '', itinerary_item_id: '', split_method: 'equal' as const });
const split = (ids: string[], cents: number) => computeSplits(cents, 'equal', ids.map((userId) => ({ userId }))).map((s) => ({ user_id: s.userId, amount_cents: s.amountCents, share_value: null }));

describe('trips and travelers', () => {
  it('creates a trip with you first, the others after, and destinations', async () => {
    const { d } = await makeTrip(['Michelle', 'Jon', ' jon ', '', 'Sam']);
    expect(d.travelers.map((t) => t.name)).toEqual(['Michelle', 'Jon', 'Sam']); // blanks and duplicates dropped
    expect(d.travelers.filter((t) => t.is_me).map((t) => t.name)).toEqual(['Michelle']);
    expect(d.me).toBe(d.travelers[0].id);
    expect(d.destinations.map((x) => x.name)).toEqual(['Ponce']);
    expect(d.trip).toMatchObject({ status: 'planning', default_currency: 'USD', budget_near_pct: 80 });
  });
  it('validates dates, names and needs a traveler', async () => {
    await expect(trips.create({ ...base, end_date: '2027-06-01' }, ['A'], [])).rejects.toThrow(/before the start/);
    await expect(trips.create({ ...base, name: '  ' }, ['A'], [])).rejects.toThrow(/name is required/i);
    await expect(trips.create(base, [' '], [])).rejects.toThrow(/Add your name/);
    await expect(trips.create({ ...base, cover_image_url: 'http://x.com/a.png' }, ['A'], [])).rejects.toThrow(/https/);
    expect(await trips.list()).toHaveLength(0);
  });
  it('lists newest trips first and updates with validation', async () => {
    const a = await trips.create({ ...base, name: 'Older', start_date: '2026-01-01', end_date: '2026-01-03' }, ['A'], []);
    const b = await trips.create({ ...base, name: 'Newer' }, ['A'], []);
    expect((await trips.list()).map((t) => t.name)).toEqual(['Newer', 'Older']);
    await trips.update(a.id, { status: 'completed' });
    expect((await loadTrip(a.id)).trip.status).toBe('completed');
    await expect(trips.update(a.id, { end_date: '2025-01-01' })).rejects.toThrow(/before the start/);
    await expect(trips.update(b.id, { budget_near_pct: 500 })).rejects.toThrow();
  });
  it('adds, renames and switches "me" without allowing duplicate names', async () => {
    const { t, d } = await makeTrip(['Michelle']);
    await travelers.add(t.id, 'Mom');
    await expect(travelers.add(t.id, 'mom')).rejects.toThrow(/already on this trip/);
    const mom = (await loadTrip(t.id)).travelers.find((x) => x.name === 'Mom')!;
    await travelers.rename(mom.id, 'Mama');
    await expect(travelers.rename(mom.id, 'Michelle')).rejects.toThrow(/already/);
    await travelers.setMe(t.id, mom.id);
    const after = await loadTrip(t.id);
    expect(after.me).toBe(mom.id);
    expect(after.travelers.filter((x) => x.is_me)).toHaveLength(1);
    expect(d.travelers).toHaveLength(1);
  });
  it('a trip that does not exist cannot be loaded or written to', async () => {
    await expect(loadTrip('nope')).rejects.toThrow(/no longer exists/);
    await expect(rows.insert('itinerary_items', { trip_id: 'nope', title: 'x', local_date: '2027-06-12' })).rejects.toThrow(/no longer exists/);
  });
});

describe('itinerary and other rows', () => {
  it('fills defaults and rejects invalid rows', async () => {
    const { t } = await makeTrip();
    const item = await rows.insert<{ id: string; cost_cents: number | null; sort_order: number }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12', item_type: 'flight', description: '   ' });
    expect(item).toMatchObject({ cost_cents: null, sort_order: 0 });
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: '', local_date: '2027-06-12' })).rejects.toThrow(/Title is required/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-13-40' })).rejects.toThrow(/Date/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-06-12', start_at: '2027-06-12T13:00:00Z' })).rejects.toThrow(/time zone/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-06-12', start_at: '2027-06-12T13:00:00Z', start_tz: 'UTC', end_at: '2027-06-12T12:00:00Z', end_tz: 'UTC' })).rejects.toThrow(/end must be after/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-06-12', cost_cents: -5, currency: 'USD' })).rejects.toThrow(/Cost/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-06-12', latitude: 18 })).rejects.toThrow(/both latitude and longitude/);
    await expect(rows.insert('itinerary_items', { trip_id: t.id, title: 'x', local_date: '2027-06-12', website: 'javascript:alert(1)' })).rejects.toThrow(/http/);
  });
  it('updates keep the row on its trip and refuse invalid changes', async () => {
    const a = (await makeTrip()).t;
    const b = (await makeTrip()).t;
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: a.id, title: 'Dinner', local_date: '2027-06-12' });
    await rows.update('itinerary_items', item.id, { title: 'Late dinner', trip_id: b.id }); // trip_id in the patch is ignored
    expect((await loadTrip(a.id)).items.map((i) => i.title)).toEqual(['Late dinner']);
    expect((await loadTrip(b.id)).items).toHaveLength(0);
    await expect(rows.update('itinerary_items', item.id, { title: '' })).rejects.toThrow();
  });
  it('removing a destination or item unlinks, never deletes, what pointed at it', async () => {
    const { t, d } = await makeTrip();
    const dest = d.destinations[0];
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Tour', local_date: '2027-06-13', destination_id: dest.id });
    const res = await rows.insert<{ id: string }>('reservations', { trip_id: t.id, kind: 'activity', title: 'Tour booking', itinerary_item_id: item.id });
    await expenses.save(t.id, null, { ...exp(d.me, 1000), itinerary_item_id: item.id }, split([d.me], 1000));
    await rows.remove('destinations', dest.id);
    expect((await loadTrip(t.id)).items[0].destination_id).toBeNull();
    await rows.remove('itinerary_items', item.id);
    const after = await loadTrip(t.id);
    expect(after.reservations.find((r) => r.id === res.id)!.itinerary_item_id).toBeNull();
    expect(after.expenses[0].itinerary_item_id).toBeNull();
    expect(after.expenses).toHaveLength(1);
  });
  it('cross-trip references are rejected', async () => {
    const a = (await makeTrip()).t;
    const b = (await makeTrip()).t;
    const foreign = await rows.insert<{ id: string }>('itinerary_items', { trip_id: b.id, title: 'Elsewhere', local_date: '2027-06-12' });
    await expect(rows.insert('reservations', { trip_id: a.id, kind: 'hotel', title: 'x', itinerary_item_id: foreign.id })).rejects.toThrow(/not on this trip/);
    await expect(rows.insert('notes', { trip_id: a.id, scope: 'itinerary', target_id: foreign.id, body: 'hi' })).rejects.toThrow(/not on this trip/);
  });
  it('notes: trip-level has no target; other scopes need one', async () => {
    const { t } = await makeTrip();
    await rows.insert('notes', { trip_id: t.id, scope: 'trip', body: 'Bring cash' });
    await expect(rows.insert('notes', { trip_id: t.id, scope: 'trip', target_id: 'x', body: 'no' })).rejects.toThrow();
    await expect(rows.insert('notes', { trip_id: t.id, scope: 'itinerary', body: 'no target' })).rejects.toThrow();
  });
  it('budgets: one per category; money must be non-negative', async () => {
    const { t } = await makeTrip();
    await rows.insert('budgets', { trip_id: t.id, category: null, amount_cents: 200000, currency: 'USD' });
    await rows.insert('budgets', { trip_id: t.id, category: 'Food', amount_cents: 50000, currency: 'USD' });
    await expect(rows.insert('budgets', { trip_id: t.id, category: 'Food', amount_cents: 1, currency: 'USD' })).rejects.toThrow(/already exists/);
    await expect(rows.insert('budgets', { trip_id: t.id, category: 'Lodging', amount_cents: -1, currency: 'USD' })).rejects.toThrow();
    await expect(rows.insert('budgets', { trip_id: t.id, category: 'Nope', amount_cents: 1, currency: 'USD' })).rejects.toThrow();
  });
});

describe('packing', () => {
  it('applies a template to the shared list or one traveler list, and toggles items', async () => {
    const { t, d } = await makeTrip();
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[1], true, d.me);
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, d.travelers[1].id);
    const after = await loadTrip(t.id);
    expect(after.packingItems.filter((i) => i.is_shared).length).toBe(21);
    expect(after.packingItems.filter((i) => !i.is_shared && i.owner_id === d.travelers[1].id).length).toBeGreaterThan(5);
    await packing.toggle(after.packingItems[0].id, true);
    expect((await loadTrip(t.id)).packingItems.filter((i) => i.packed)).toHaveLength(1);
    await expect(packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, 'stranger')).rejects.toThrow(/whose list/);
  });
  it('items must sit in a category of the same list; deleting a category deletes its items', async () => {
    const { t, d } = await makeTrip();
    const shared = await rows.insert<{ id: string }>('packing_categories', { trip_id: t.id, name: 'Shared' });
    const mine = await rows.insert<{ id: string }>('packing_categories', { trip_id: t.id, name: 'Mine', is_shared: false, owner_id: d.me });
    await expect(rows.insert('packing_items', { trip_id: t.id, category_id: mine.id, name: 'x' })).rejects.toThrow(/same list/);
    await expect(rows.insert('packing_items', { trip_id: t.id, category_id: shared.id, name: 'x', quantity: 0 })).rejects.toThrow(/Quantity/);
    await expect(rows.insert('packing_items', { trip_id: t.id, category_id: shared.id, name: 'x', assigned_to: 'stranger' })).rejects.toThrow(/not on this trip/);
    await rows.insert('packing_items', { trip_id: t.id, category_id: shared.id, name: 'Sunscreen', assigned_to: d.travelers[1].id });
    await rows.remove('packing_categories', shared.id);
    expect((await loadTrip(t.id)).packingItems).toHaveLength(0);
  });
  it('removing a traveler removes their personal list and clears their assignments', async () => {
    const { t, d } = await makeTrip();
    const [me, jon] = d.travelers;
    const shared = await rows.insert<{ id: string }>('packing_categories', { trip_id: t.id, name: 'Shared' });
    await rows.insert('packing_items', { trip_id: t.id, category_id: shared.id, name: 'Cooler', assigned_to: jon.id });
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, jon.id);
    await travelers.remove(jon.id);
    const after = await loadTrip(t.id);
    expect(after.packingItems.find((i) => i.name === 'Cooler')!.assigned_to).toBeNull();
    expect(after.packingItems.some((i) => i.owner_id === jon.id)).toBe(false);
    expect(after.travelers.map((x) => x.id)).not.toContain(jon.id);
    expect(me.id).toBe(after.me);
  });
});

describe('expenses and balances', () => {
  it('saves a balanced expense and the balances match the spec example', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    const [m, j] = d.travelers.map((x) => x.id);
    await expenses.save(t.id, null, exp(m, 30000), split([m, j], 30000));
    await expenses.save(t.id, null, exp(j, 10000), split([m, j], 10000));
    const after = await loadTrip(t.id);
    const net = computeNetBalances(after.expenses.map(expenseLike), after.settlements.map(settlementLike));
    expect(suggestSettlements(net)).toEqual([{ from: j, to: m, amountCents: 10000, currency: 'USD' }]);
  });
  it('rejects splits that do not add up, bad money, strangers and duplicates', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    const [m, j] = d.travelers.map((x) => x.id);
    await expect(expenses.save(t.id, null, exp(m, 10000), [{ user_id: m, amount_cents: 3333, share_value: null }, { user_id: j, amount_cents: 3333, share_value: null }])).rejects.toThrow(/must add up/);
    await expect(expenses.save(t.id, null, exp(m, 0), split([m], 1))).rejects.toThrow(/greater than zero/);
    await expect(expenses.save(t.id, null, exp(m, -5), [{ user_id: m, amount_cents: -5, share_value: null }])).rejects.toThrow();
    await expect(expenses.save(t.id, null, exp(m, 10.5), split([m], 10))).rejects.toThrow();
    await expect(expenses.save(t.id, null, { ...exp(m, 100), currency: 'usd' }, split([m], 100))).rejects.toThrow(/currency/i);
    await expect(expenses.save(t.id, null, exp('stranger', 100), split([m], 100))).rejects.toThrow(/payer/);
    await expect(expenses.save(t.id, null, exp(m, 100), split(['stranger'], 100))).rejects.toThrow(/traveler/);
    await expect(expenses.save(t.id, null, exp(m, 100), [{ user_id: m, amount_cents: 50, share_value: null }, { user_id: m, amount_cents: 50, share_value: null }])).rejects.toThrow(/twice/);
    await expect(expenses.save(t.id, null, exp(m, 10_000_000_000_000), split([m], 10_000_000_000_000))).rejects.toThrow();
    expect((await loadTrip(t.id)).expenses).toHaveLength(0); // a rejected save leaves nothing behind
  });
  it('edits replace the splits atomically and keep the creation time', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    const [m, j] = d.travelers.map((x) => x.id);
    const id = await expenses.save(t.id, null, exp(m, 10000), split([m, j], 10000));
    const created = (await loadTrip(t.id)).expenses[0].created_at;
    await expenses.save(t.id, id, { ...exp(m, 6000), description: 'Fixed' }, split([m], 6000));
    const e = (await loadTrip(t.id)).expenses[0];
    expect(e).toMatchObject({ id, description: 'Fixed', amount_cents: 6000, created_at: created });
    expect(e.expense_splits).toHaveLength(1);
    await expect(expenses.save(t.id, id, exp(m, 6000), [{ user_id: m, amount_cents: 5999, share_value: null }])).rejects.toThrow(/add up/);
    expect((await loadTrip(t.id)).expenses[0].amount_cents).toBe(6000); // failed edit changed nothing
  });
  it('payments: partial payments reduce the debt; invalid ones are refused; they can be undone', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    const [m, j] = d.travelers.map((x) => x.id);
    await expenses.save(t.id, null, exp(m, 20000), split([m, j], 20000));
    const sid = await expenses.settle(t.id, j, m, 4000, 'USD', '2027-06-19', 'cash');
    let a = await loadTrip(t.id);
    expect(suggestSettlements(computeNetBalances(a.expenses.map(expenseLike), a.settlements.map(settlementLike)))).toEqual([{ from: j, to: m, amountCents: 6000, currency: 'USD' }]);
    await expect(expenses.settle(t.id, j, j, 100, 'USD', '2027-06-19', '')).rejects.toThrow(/different people/);
    await expect(expenses.settle(t.id, j, m, 0, 'USD', '2027-06-19', '')).rejects.toThrow(/greater than zero/);
    await expect(expenses.settle(t.id, j, 'stranger', 100, 'USD', '2027-06-19', '')).rejects.toThrow(/travelers/);
    await expenses.removeSettlement(sid);
    a = await loadTrip(t.id);
    expect(a.settlements).toHaveLength(0);
  });
  it('a traveler with expenses or payments cannot be removed (balances never change by accident)', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon', 'Sam']);
    const [m, j, s] = d.travelers.map((x) => x.id);
    await expenses.save(t.id, null, exp(m, 3000), split([m, j], 3000));
    await expect(travelers.remove(j)).rejects.toThrow(/appears in expenses/);
    await travelers.remove(s); // Sam is in nothing
    await expenses.settle(t.id, j, m, 500, 'USD', '2027-06-19', '');
    const id = (await loadTrip(t.id)).expenses[0].id;
    await expenses.remove(id);
    await expect(travelers.remove(j)).rejects.toThrow(/appears in expenses or payments/); // still in a payment
    await expect(travelers.remove(m)).rejects.toThrow(/appears in expenses or payments/);
  });
  it('the last traveler cannot be removed, and removing "me" promotes someone else', async () => {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    await travelers.remove(d.me);
    const after = await loadTrip(t.id);
    expect(after.travelers).toHaveLength(1);
    expect(after.travelers[0].is_me).toBe(true);
    await expect(travelers.remove(after.travelers[0].id)).rejects.toThrow(/at least one traveler/);
  });
});

describe('documents', () => {
  const file = (name: string, type: string, bytes = 20) => new File([new Uint8Array(bytes)], name, { type });
  it('stores, opens and removes a file; rejects wrong types and big files', async () => {
    const { t } = await makeTrip();
    const doc = await documents.upload(t.id, file('hotel (conf).pdf', 'application/pdf'), {});
    expect((await loadTrip(t.id)).documents[0]).toMatchObject({ file_name: 'hotel (conf).pdf', size_bytes: 20 });
    expect(await documents.openUrl(doc.id)).toMatch(/^blob:/);
    await expect(documents.upload(t.id, file('x.exe', 'application/x-msdownload'), {})).rejects.toThrow(/PDF, image/);
    await expect(documents.upload(t.id, file('big.pdf', 'application/pdf', 10 * 1024 * 1024 + 1), {})).rejects.toThrow(/10 MB/);
    await expect(documents.upload(t.id, file('a.pdf', 'application/pdf'), { reservation_id: 'nope' })).rejects.toThrow(/not on this trip/);
    await documents.remove(doc);
    expect((await loadTrip(t.id)).documents).toHaveLength(0);
    await expect(documents.openUrl(doc.id)).rejects.toThrow(/missing/);
  });
  it('deleting a trip deletes its files too', async () => {
    const { t } = await makeTrip();
    const doc = await documents.upload(t.id, file('a.pdf', 'application/pdf'), {});
    await trips.remove(t.id);
    expect(await trips.list()).toHaveLength(0);
    await expect(documents.openUrl(doc.id)).rejects.toThrow(/missing/);
  });
});

describe('delete a trip', () => {
  it('removes the trip and everything in it, but not other trips', async () => {
    const a = await makeTrip();
    const b = await makeTrip(['Other']);
    await expenses.save(a.t.id, null, exp(a.d.me, 500), split([a.d.me], 500));
    await rows.insert('notes', { trip_id: a.t.id, scope: 'trip', body: 'hi' });
    await trips.remove(a.t.id);
    await expect(loadTrip(a.t.id)).rejects.toThrow();
    expect((await trips.list()).map((t) => t.id)).toEqual([b.t.id]);
    expect((await loadTrip(b.t.id)).travelers).toHaveLength(1);
  });
});

describe('backup, restore and trip files', () => {
  async function richTrip() {
    const { t, d } = await makeTrip(['Michelle', 'Jon']);
    const [m, j] = d.travelers.map((x) => x.id);
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12', destination_id: d.destinations[0].id, start_at: '2027-06-12T13:00:00Z', start_tz: 'America/Chicago' });
    const res = await rows.insert<{ id: string }>('reservations', { trip_id: t.id, kind: 'flight', title: 'AUS-SJU', itinerary_item_id: item.id, details: { seat: '14A' } });
    await rows.insert('notes', { trip_id: t.id, scope: 'reservation', target_id: res.id, body: 'window seat' });
    await expenses.save(t.id, null, { ...exp(m, 10001), itinerary_item_id: item.id }, split([m, j], 10001));
    await expenses.settle(t.id, j, m, 2500, 'USD', '2027-06-19', 'cash');
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, j);
    await rows.insert('budgets', { trip_id: t.id, category: null, amount_cents: 100000, currency: 'USD' });
    await documents.upload(t.id, new File([new Uint8Array([1, 2, 3, 4])], 'conf.pdf', { type: 'application/pdf' }), { reservation_id: res.id });
    return t;
  }
  it('round-trips everything through a file, including documents', async () => {
    const t = await richTrip();
    const before = await loadTrip(t.id);
    const text = JSON.stringify(await exportData({ includeFiles: true }));
    await eraseEverything();
    expect(await trips.list()).toHaveLength(0);
    await restoreAll(parseBackup(text));
    expect(await loadTrip(t.id)).toEqual(before);
    const url = await documents.openUrl(before.documents[0].id);
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });
  it('importing a trip file adds an independent copy with fresh ids and intact links', async () => {
    const t = await richTrip();
    const file = parseBackup(JSON.stringify(await exportData({ tripId: t.id, includeFiles: true })));
    const [copyId] = await importTrips(file);
    expect(copyId).not.toBe(t.id);
    const orig = await loadTrip(t.id);
    const copy = await loadTrip(copyId);
    expect(copy.trip.name).toBe('Puerto Rico (copy)');
    const ids = [...copy.travelers, ...copy.items, ...copy.expenses, ...copy.documents].map((r) => r.id);
    const origIds = new Set([...orig.travelers, ...orig.items, ...orig.expenses, ...orig.documents].map((r) => r.id));
    expect(ids.every((id) => !origIds.has(id))).toBe(true);
    // links were remapped inside the copy, not left pointing at the original
    expect(copy.items[0].destination_id).toBe(copy.destinations[0].id);
    expect(copy.reservations[0].itinerary_item_id).toBe(copy.items[0].id);
    expect(copy.notes[0].target_id).toBe(copy.reservations[0].id);
    expect(copy.expenses[0].itinerary_item_id).toBe(copy.items[0].id);
    expect(copy.expenses[0].paid_by).toBe(copy.travelers[0].id);
    expect(copy.expenses[0].expense_splits.map((s) => s.user_id).sort()).toEqual(copy.travelers.map((x) => x.id).sort());
    expect(copy.settlements[0]).toMatchObject({ from_user: copy.travelers[1].id, to_user: copy.travelers[0].id });
    expect(copy.packingItems.every((i) => i.owner_id === copy.travelers[1].id && copy.packingCategories.some((c) => c.id === i.category_id))).toBe(true);
    expect(copy.documents[0].reservation_id).toBe(copy.reservations[0].id);
    expect(await documents.openUrl(copy.documents[0].id)).toMatch(/^blob:/);
    // balances identical
    const bal = (d: typeof orig) => Object.values(computeNetBalances(d.expenses.map(expenseLike), d.settlements.map(settlementLike)).USD).sort((a, b) => a - b);
    expect(bal(copy)).toEqual(bal(orig));
    expect(orig).toEqual(await loadTrip(t.id)); // the original is untouched
  });
  it('rejects files that are not backups, are damaged, or contain impossible money', async () => {
    await expect(Promise.resolve().then(() => parseBackup('not json'))).rejects.toThrow(/couldn't be read/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/isn't a TripNest backup/);
    expect(() => parseBackup('{"app":"tripnest","format":99,"tables":{}}')).toThrow(/different version/);
    const t = await richTrip();
    const good = await exportData({ includeFiles: false });
    const tamper = (fn: (b: typeof good) => void) => { const c = JSON.parse(JSON.stringify(good)); fn(c); return JSON.stringify(c); };
    expect(() => parseBackup(tamper((b) => { b.tables.expenses[0].amount_cents = 1; }))).toThrow(/split does not add up/);
    expect(() => parseBackup(tamper((b) => { b.tables.trips[0].end_date = '2020-01-01'; }))).toThrow(/trip in that backup is invalid/);
    expect(() => parseBackup(tamper((b) => { b.tables.settlements[0].to_user = b.tables.settlements[0].from_user; }))).toThrow(/payment/);
    expect(() => parseBackup(tamper((b) => { b.tables.itinerary_items[0].trip_id = 'ghost'; }))).toThrow(/belong to no trip/);
    expect(() => parseBackup(tamper((b) => { b.tables.travelers.push({ ...b.tables.travelers[0] }); }))).toThrow(/duplicate/);
    expect(() => parseBackup(tamper((b) => { b.tables.itinerary_items[0].item_type = 'bogus'; }))).toThrow(/itinerary item/);
    expect(parseBackup(JSON.stringify(good)).tables.trips[0].id).toBe(t.id); // the untouched file is accepted
    expect(backupFileName('Puerto Rico!')).toMatch(/^tripnest-puerto-rico-\d{4}-\d{2}-\d{2}\.json$/);
  });
  it('a failed restore leaves existing data intact', async () => {
    const t = await richTrip();
    const bad = parseBackup(JSON.stringify(await exportData({ includeFiles: false })));
    bad.tables.trips = [{ id: 'x', name: 'ok', start_date: '2027-01-01', end_date: '2027-01-02' }];
    bad.files = { x: { type: 'application/pdf', data: '%%%not base64%%%' } };
    bad.tables.documents = [{ id: 'x', trip_id: 'x' }];
    await expect(restoreAll(bad)).rejects.toThrow();
    expect((await loadTrip(t.id)).travelers).toHaveLength(2); // transaction rolled back
  });
});
