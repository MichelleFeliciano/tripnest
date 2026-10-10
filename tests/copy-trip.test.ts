/** "Copy this trip": what comes along, what stays behind, and how dates and times move. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/api/db';
import { documents, expenses, loadTrip, packing, rows, tasks, trips } from '../src/api/api';
import { copyTrip, daysBetween, type CopyOptions } from '../src/api/copyTrip';
import { PACKING_TEMPLATES } from '../src/lib/packing';
import { localDate, localTime } from '../src/lib/time';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });

const ALL_ON = { itinerary: true, packing: true, todo: true, budget: true, notes: true };
const opts = (o: Partial<CopyOptions> = {}): CopyOptions => ({ name: 'Next year', startDate: '2028-06-12', ...ALL_ON, ...o });

async function source() {
  const t = await trips.create({ name: 'Original', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me', 'Jon'], ['Ponce']);
  const d = await loadTrip(t.id);
  const [me, jon] = d.travelers.map((x) => x.id);
  const dest = d.destinations[0];
  const flight = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12', start_at: '2027-06-12T13:00:00.000Z', start_tz: 'America/Chicago', end_at: '2027-06-12T16:30:00.000Z', end_tz: 'America/New_York', confirmation_number: 'ABC123', destination_id: dest.id, cost_cents: 30000, currency: 'USD' });
  await rows.insert('itinerary_items', { trip_id: t.id, title: 'Beach', local_date: '2027-06-13' });
  await rows.insert('reservations', { trip_id: t.id, kind: 'hotel', title: 'Hotel', confirmation_number: 'HOTEL9', itinerary_item_id: flight.id });
  await rows.insert('notes', { trip_id: t.id, scope: 'trip', target_id: null, body: 'Bring cash' });
  await rows.insert('notes', { trip_id: t.id, scope: 'itinerary', target_id: flight.id, body: 'Window seat' });
  await rows.insert('notes', { trip_id: t.id, scope: 'destination', target_id: dest.id, body: 'Try the market' });
  await rows.insert('budgets', { trip_id: t.id, category: null, amount_cents: 100000, currency: 'USD' });
  await tasks.add(t.id, 'Book flights', '2027-04-12');
  const [task] = (await loadTrip(t.id)).tasks;
  await tasks.toggle(task.id, true);
  await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], true, me);
  const p = (await loadTrip(t.id)).packingItems[0];
  await rows.update('packing_items', p.id, { packed: true });
  await expenses.save(t.id, null, { paid_by: me, description: 'Cabin', amount_cents: 9000, currency: 'USD', expense_date: '2027-06-13', category: 'Lodging', notes: '', itinerary_item_id: flight.id, split_method: 'equal' }, [{ user_id: me, amount_cents: 4500, share_value: null }, { user_id: jon, amount_cents: 4500, share_value: null }]);
  await documents.upload(t.id, new File([new Uint8Array([1, 2, 3])], 'a.pdf', { type: 'application/pdf' }), {});
  return { t, me, jon, flight };
}

describe('copyTrip', () => {
  it('counts days between dates, including across leap days', () => {
    expect(daysBetween('2027-06-12', '2028-06-12')).toBe(366); // 2028 is a leap year, Feb 29 is in between
    expect(daysBetween('2028-06-12', '2027-06-12')).toBe(-366);
    expect(daysBetween('2027-06-12', '2027-06-12')).toBe(0);
  });

  it('shifts the trip and keeps its length, as a fresh Planning trip', async () => {
    const { t } = await source();
    const id = await copyTrip(t.id, opts());
    const c = (await loadTrip(id)).trip;
    expect([c.name, c.start_date, c.end_date, c.status]).toEqual(['Next year', '2028-06-12', '2028-06-14', 'planning']);
    expect((await loadTrip(t.id)).trip.start_date).toBe('2027-06-12'); // the original is untouched
  });

  it('keeps the same wall-clock times in each time zone, and drops confirmation numbers', async () => {
    const { t } = await source();
    const d = await loadTrip(await copyTrip(t.id, opts()));
    const f = d.items.find((i) => i.title === 'Flight')!;
    expect(f.local_date).toBe('2028-06-12');
    expect(localDate(f.start_at!, 'America/Chicago')).toBe('2028-06-12');
    expect(localTime(f.start_at!, 'America/Chicago')).toBe('08:00');
    expect(localTime(f.end_at!, 'America/New_York')).toBe('12:30');
    expect(f.confirmation_number).toBeNull();
    expect(f.cost_cents).toBe(30000);
    expect(f.destination_id).toBe(d.destinations[0].id); // links point at the copy, not the original
  });

  it('leaves behind money, documents and bookings', async () => {
    const { t } = await source();
    const d = await loadTrip(await copyTrip(t.id, opts()));
    expect(d.expenses).toHaveLength(0);
    expect(d.settlements).toHaveLength(0);
    expect(d.documents).toHaveLength(0);
    expect(d.reservations).toHaveLength(0);
  });

  it('resets packed and done, and moves to-do due dates with the trip', async () => {
    const { t } = await source();
    const d = await loadTrip(await copyTrip(t.id, opts()));
    expect(d.packingItems.length).toBeGreaterThan(0);
    expect(d.packingItems.every((p) => !p.packed)).toBe(true);
    expect(d.tasks.map((x) => [x.title, x.done, x.due_date])).toEqual([['Book flights', false, '2028-04-12']]);
  });

  it('keeps the same travelers, with notes and budgets attached to the copy', async () => {
    const { t } = await source();
    const d = await loadTrip(await copyTrip(t.id, opts()));
    expect(d.travelers.map((x) => x.name)).toEqual(['Me', 'Jon']);
    expect(d.budgets).toHaveLength(1);
    const flight = d.items.find((i) => i.title === 'Flight')!;
    expect(d.notes.find((n) => n.scope === 'itinerary')!.target_id).toBe(flight.id);
    expect(d.notes.find((n) => n.scope === 'destination')!.target_id).toBe(d.destinations[0].id);
  });

  it('leaves out whatever is switched off, with no dangling notes', async () => {
    const { t } = await source();
    const d = await loadTrip(await copyTrip(t.id, opts({ name: 'Bare', itinerary: false, packing: false, todo: false, budget: false })));
    expect(d.items).toHaveLength(0);
    expect(d.packingItems).toHaveLength(0);
    expect(d.packingCategories).toHaveLength(0);
    expect(d.tasks).toHaveLength(0);
    expect(d.budgets).toHaveLength(0);
    expect(d.notes.map((n) => n.scope).sort()).toEqual(['destination', 'trip']); // the note about a removed item is dropped
    const none = await loadTrip(await copyTrip(t.id, opts({ name: 'No notes', notes: false })));
    expect(none.notes).toHaveLength(0);
  });

  it('refuses a blank name or a bad date, and copies nothing', async () => {
    const { t } = await source();
    await expect(copyTrip(t.id, opts({ name: '  ' }))).rejects.toThrow(/name/i);
    await expect(copyTrip(t.id, opts({ startDate: '2028-02-30' }))).rejects.toThrow(/date/i);
    expect(await trips.list()).toHaveLength(1);
  });
});
