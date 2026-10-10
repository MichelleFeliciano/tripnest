/** Undo / "Recently deleted", the to-do list, and upgrading an existing version-1 database. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, transaction } from '../src/api/db';
import { documents, expenses, itinerary, loadTrip, packing, rows, tasks, travelers, trash, trips } from '../src/api/api';
import { eraseEverything, exportData, parseBackup, restoreAll } from '../src/api/backup';
import { PACKING_TEMPLATES } from '../src/lib/packing';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });

const exp = (paid: string, cents: number, item = '') => ({ paid_by: paid, description: 'Cabin', amount_cents: cents, currency: 'USD', expense_date: '2027-06-13', category: 'Lodging', notes: '', itinerary_item_id: item, split_method: 'equal' as const });
async function setup() {
  const t = await trips.create({ name: 'Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me', 'Jon'], ['Ponce']);
  const d = await loadTrip(t.id);
  return { t, d, me: d.travelers[0].id, jon: d.travelers[1].id };
}
/** A restored row is stamped as a new change (so it also wins over a deletion that was already shared), so compare without the stamp. */
const noStamp = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'updated_at' ? undefined : x)));
const file = (n: string) => new File([new Uint8Array([1, 2, 3, 4, 5])], n, { type: 'application/pdf' });

describe('upgrading from version 1', () => {
  it('keeps every existing record and adds the new stores', async () => {
    // Build a genuine version-1 database by hand, the way the first release did.
    const V1 = ['trips', 'travelers', 'destinations', 'itinerary_items', 'reservations', 'packing_categories', 'packing_items', 'expenses', 'settlements', 'budgets', 'notes', 'documents'];
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('tripnest', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const t of V1) { const s = db.createObjectStore(t, { keyPath: 'id' }); if (t !== 'trips') s.createIndex('trip_id', 'trip_id'); }
        db.createObjectStore('blobs', { keyPath: 'id' });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['trips', 'travelers'], 'readwrite');
        tx.objectStore('trips').put({ id: 'old-trip', name: 'From v1', description: null, start_date: '2027-01-01', end_date: '2027-01-03', cover_image_url: null, primary_destination: null, status: 'planning', notes: null, default_currency: 'USD', budget_near_pct: 80, created_at: '2026-12-01T00:00:00Z' });
        tx.objectStore('travelers').put({ id: 'old-me', trip_id: 'old-trip', name: 'Me', is_me: true, sort_order: 0 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    closeDb();
    expect((await trips.list()).map((t) => t.name)).toEqual(['From v1']); // opened at version 2, data intact
    const d = await loadTrip('old-trip');
    expect(d.travelers.map((x) => x.name)).toEqual(['Me']);
    expect(d.tasks).toEqual([]);
    await tasks.add('old-trip', 'Book flights', '2027-02-01'); // the new store works
    const gone = await rows.remove('notes', (await rows.insert<{ id: string }>('notes', { trip_id: 'old-trip', scope: 'trip', body: 'x' })).id);
    expect(gone?.id).toBeTruthy(); // and so does the trash
    expect(await trash.list()).toHaveLength(1);
  });
});

describe('recently deleted: restore puts everything back', () => {
  it('an expense', async () => {
    const { t, me, jon } = await setup();
    const id = await expenses.save(t.id, null, exp(me, 9001), [{ user_id: me, amount_cents: 4500, share_value: null }, { user_id: jon, amount_cents: 4501, share_value: null }]);
    const before = (await loadTrip(t.id)).expenses[0];
    const del = await expenses.remove(id);
    expect(del?.summary).toBe('Expense “Cabin ($90.01)”');
    expect((await loadTrip(t.id)).expenses).toHaveLength(0);
    expect(await trash.list()).toHaveLength(1);
    await trash.restore(del!.id);
    expect(noStamp((await loadTrip(t.id)).expenses[0])).toEqual(noStamp(before));
    expect(Date.parse((await loadTrip(t.id)).expenses[0].updated_at!)).toBeGreaterThanOrEqual(Date.parse(before.updated_at!));
    expect(await trash.list()).toHaveLength(0);
  });

  it('a payment', async () => {
    const { t, me, jon } = await setup();
    await expenses.save(t.id, null, exp(me, 2000), [{ user_id: me, amount_cents: 1000, share_value: null }, { user_id: jon, amount_cents: 1000, share_value: null }]);
    const sid = await expenses.settle(t.id, jon, me, 500, 'USD', '2027-06-14', 'cash');
    const before = (await loadTrip(t.id)).settlements[0];
    const del = await expenses.removeSettlement(sid);
    expect(del?.summary).toContain('Payment');
    await trash.restore(del!.id);
    expect(noStamp((await loadTrip(t.id)).settlements[0])).toEqual(noStamp(before));
  });

  it('an itinerary item brings back the links from reservations, expenses and documents', async () => {
    const { t, me, jon } = await setup();
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Tour', local_date: '2027-06-13' });
    const res = await rows.insert<{ id: string }>('reservations', { trip_id: t.id, kind: 'activity', title: 'Tour booking', itinerary_item_id: item.id });
    await expenses.save(t.id, null, exp(me, 1000, item.id), [{ user_id: me, amount_cents: 500, share_value: null }, { user_id: jon, amount_cents: 500, share_value: null }]);
    await documents.upload(t.id, file('ticket.pdf'), { itinerary_item_id: item.id });
    const del = await rows.remove('itinerary_items', item.id);
    let d = await loadTrip(t.id);
    expect([d.reservations[0].itinerary_item_id, d.expenses[0].itinerary_item_id, d.documents[0].itinerary_item_id]).toEqual([null, null, null]);
    await trash.restore(del!.id);
    d = await loadTrip(t.id);
    expect(d.items.map((i) => i.title)).toEqual(['Tour']);
    expect([d.reservations.find((r) => r.id === res.id)!.itinerary_item_id, d.expenses[0].itinerary_item_id, d.documents[0].itinerary_item_id]).toEqual([item.id, item.id, item.id]);
  });

  it('a destination relinks the items that used it; a reservation relinks its documents', async () => {
    const { t, d } = await setup();
    const dest = d.destinations[0];
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Walk', local_date: '2027-06-13', destination_id: dest.id });
    const del = await rows.remove('destinations', dest.id);
    expect((await loadTrip(t.id)).items[0].destination_id).toBeNull();
    await trash.restore(del!.id);
    expect((await loadTrip(t.id)).items.find((i) => i.id === item.id)!.destination_id).toBe(dest.id);

    const res = await rows.insert<{ id: string }>('reservations', { trip_id: t.id, kind: 'hotel', title: 'Hotel' });
    await documents.upload(t.id, file('hotel.pdf'), { reservation_id: res.id });
    const del2 = await rows.remove('reservations', res.id);
    expect((await loadTrip(t.id)).documents[0].reservation_id).toBeNull();
    await trash.restore(del2!.id);
    expect((await loadTrip(t.id)).documents[0].reservation_id).toBe(res.id);
  });

  it('a packing category brings its items back with it', async () => {
    const { t, me } = await setup();
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[1], true, me);
    const before = await loadTrip(t.id);
    const cat = before.packingCategories.find((c) => c.name === 'Beach Gear')!;
    const n = before.packingItems.filter((i) => i.category_id === cat.id).length;
    expect(n).toBe(5);
    const del = await rows.remove('packing_categories', cat.id);
    expect((await loadTrip(t.id)).packingItems).toHaveLength(before.packingItems.length - n);
    await trash.restore(del!.id);
    expect((await loadTrip(t.id)).packingItems.filter((i) => i.category_id === cat.id)).toHaveLength(n);
  });

  it('a document brings its file back', async () => {
    const { t } = await setup();
    const doc = await documents.upload(t.id, file('a.pdf'), {});
    const del = await documents.remove(doc);
    await expect(documents.openUrl(doc.id)).rejects.toThrow(/missing/);
    await trash.restore(del!.id);
    const bytes = new Uint8Array(await (await fetch(await documents.openUrl(doc.id))).arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  it('a whole trip, with everything in it, comes back exactly', async () => {
    const { t, me, jon } = await setup();
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12', start_at: '2027-06-12T13:00:00Z', start_tz: 'America/Chicago' });
    await rows.insert('reservations', { trip_id: t.id, kind: 'flight', title: 'Booking', itinerary_item_id: item.id });
    await expenses.save(t.id, null, exp(me, 5000, item.id), [{ user_id: me, amount_cents: 2500, share_value: null }, { user_id: jon, amount_cents: 2500, share_value: null }]);
    await expenses.settle(t.id, jon, me, 100, 'USD', '2027-06-14', '');
    await packing.applyTemplate(t.id, PACKING_TEMPLATES[0], false, jon);
    await tasks.add(t.id, 'Pack', '2027-06-10');
    await rows.insert('budgets', { trip_id: t.id, category: null, amount_cents: 100000, currency: 'USD' });
    const doc = await documents.upload(t.id, file('p.pdf'), {});
    const before = await loadTrip(t.id);

    const del = await trips.remove(t.id);
    expect(del.summary).toBe('Trip “Trip”');
    expect(await trips.list()).toHaveLength(0);
    await expect(documents.openUrl(doc.id)).rejects.toThrow(/missing/);

    await trash.restore(del.id);
    expect(noStamp(await loadTrip(t.id))).toEqual(noStamp(before));
    expect(await documents.openUrl(doc.id)).toMatch(/^blob:/);
  });
});

describe('recently deleted: the awkward cases', () => {
  it('restoring twice is refused, and restoring never overwrites something that exists again', async () => {
    const { t, me } = await setup();
    const id = await expenses.save(t.id, null, exp(me, 100), [{ user_id: me, amount_cents: 100, share_value: null }]);
    const del = await expenses.remove(id);
    await trash.restore(del!.id);
    await expect(trash.restore(del!.id)).rejects.toThrow(/no longer in Recently deleted/);
    expect((await loadTrip(t.id)).expenses).toHaveLength(1);
  });

  it('an item cannot be restored into a deleted trip until the trip is restored first', async () => {
    const { t } = await setup();
    const note = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'Remember sunscreen' });
    const delNote = await rows.remove('notes', note.id);
    const delTrip = await trips.remove(t.id);
    await expect(trash.restore(delNote!.id)).rejects.toThrow(/Restore the trip first/);
    await trash.restore(delTrip.id);
    await trash.restore(delNote!.id);
    expect((await loadTrip(t.id)).notes.map((n) => n.body)).toEqual(['Remember sunscreen']);
  });

  it('a restored item does not keep a link to something deleted in the meantime', async () => {
    const { t, d } = await setup();
    const dest = d.destinations[0];
    const item = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Walk', local_date: '2027-06-13', destination_id: dest.id });
    const delItem = await rows.remove('itinerary_items', item.id);
    await rows.remove('destinations', dest.id);
    await trash.restore(delItem!.id);
    expect((await loadTrip(t.id)).items[0].destination_id).toBeNull(); // not left pointing at a destination that is gone
  });

  it('a packing item cannot come back without its category', async () => {
    const { t } = await setup();
    const cat = await rows.insert<{ id: string }>('packing_categories', { trip_id: t.id, name: 'Misc' });
    const item = await rows.insert<{ id: string }>('packing_items', { trip_id: t.id, category_id: cat.id, name: 'Hat' });
    const delItem = await rows.remove('packing_items', item.id);
    await rows.remove('packing_categories', cat.id);
    await expect(trash.restore(delItem!.id)).rejects.toThrow(/category first/);
  });

  it('entries older than 30 days are dropped; recent ones stay', async () => {
    const { t } = await setup();
    const a = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'old' });
    const b = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'new' });
    const oldDel = await rows.remove('notes', a.id);
    await rows.remove('notes', b.id);
    await transaction(['trash'], 'readwrite', async (x) => {
      const e = (await x.trashGet(oldDel!.id))!;
      await x.trashPut({ ...e, deleted_at: new Date(Date.now() - 31 * 86_400_000).toISOString() });
    });
    expect(await trash.purgeOld()).toBe(1);
    expect((await trash.list()).map((e) => e.label)).toEqual(['new']);
  });

  it('deleting a budget while editing the budget form does not clutter the list (silent)', async () => {
    const { t } = await setup();
    const b = await rows.insert<{ id: string }>('budgets', { trip_id: t.id, category: 'Food', amount_cents: 100, currency: 'USD' });
    expect(await rows.remove('budgets', b.id, { silent: true })).toBeUndefined();
    expect(await trash.list()).toHaveLength(0);
  });

  it('erasing everything and restoring a backup both empty the trash', async () => {
    const { t } = await setup();
    const n = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'x' });
    await rows.remove('notes', n.id);
    const backup = parseBackup(JSON.stringify(await exportData({ includeFiles: false })));
    expect(await trash.list()).toHaveLength(1);
    await restoreAll(backup);
    expect(await trash.list()).toHaveLength(0);
    const n2 = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'y' });
    await rows.remove('notes', n2.id);
    await eraseEverything();
    expect(await trash.list()).toHaveLength(0);
  });

  it('the trash is not part of a backup file', async () => {
    const { t } = await setup();
    const n = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', body: 'deleted note' });
    await rows.remove('notes', n.id);
    const text = JSON.stringify(await exportData({ includeFiles: false }));
    expect(text).not.toContain('deleted note');
  });
});

describe('to-do list', () => {
  it('adds, validates, toggles and orders: open tasks by due date (undated last), done tasks at the end', async () => {
    const { t } = await setup();
    const a = await tasks.add(t.id, 'Buy adapter', '');
    await tasks.add(t.id, 'Renew passport', '2027-03-01');
    const c = await tasks.add(t.id, 'Book flights', '2027-02-01');
    await tasks.toggle(c.id, true);
    expect((await loadTrip(t.id)).tasks.map((x) => x.title)).toEqual(['Renew passport', 'Buy adapter', 'Book flights']);
    await tasks.toggle(c.id, false);
    expect((await loadTrip(t.id)).tasks.map((x) => x.title)).toEqual(['Book flights', 'Renew passport', 'Buy adapter']);
    await expect(tasks.add(t.id, '   ', '')).rejects.toThrow(/Write what needs doing/);
    await expect(tasks.add(t.id, 'x', '2027-13-45')).rejects.toThrow(/due date/);
    await tasks.update(a.id, { title: 'Buy a plug adapter', due_date: '2027-05-01' });
    expect((await loadTrip(t.id)).tasks.find((x) => x.id === a.id)).toMatchObject({ title: 'Buy a plug adapter', due_date: '2027-05-01', done: false });
  });

  it('deleting a to-do can be undone', async () => {
    const { t } = await setup();
    const a = await tasks.add(t.id, 'Pack charger', '');
    const del = await tasks.remove(a.id);
    expect((await loadTrip(t.id)).tasks).toHaveLength(0);
    await trash.restore(del!.id);
    expect((await loadTrip(t.id)).tasks[0].title).toBe('Pack charger');
  });

  it('survives a backup round trip', async () => {
    const { t } = await setup();
    await tasks.add(t.id, 'Pack charger', '2027-06-01');
    const f = parseBackup(JSON.stringify(await exportData({ includeFiles: false })));
    expect(f.tables.tasks).toHaveLength(1);
    await eraseEverything();
    await restoreAll(f);
    expect((await loadTrip(t.id)).tasks[0]).toMatchObject({ title: 'Pack charger', due_date: '2027-06-01' });
  });

  it('an older backup with no to-do section still opens', async () => {
    const { t } = await setup();
    const raw = JSON.parse(JSON.stringify(await exportData({ includeFiles: false })));
    delete raw.tables.tasks;
    await eraseEverything();
    await restoreAll(parseBackup(JSON.stringify(raw)));
    expect((await loadTrip(t.id)).tasks).toEqual([]);
  });
});

describe('manual order within a day', () => {
  it('stores a new order and refuses nonsense', async () => {
    const { t } = await setup();
    const a = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'A', local_date: '2027-06-13' });
    const b = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'B', local_date: '2027-06-13' });
    await itinerary.reorder([{ id: a.id, sort_order: 1 }, { id: b.id, sort_order: 0 }]);
    const items = (await loadTrip(t.id)).items;
    expect(items.find((i) => i.id === a.id)!.sort_order).toBe(1);
    expect(items.find((i) => i.id === b.id)!.sort_order).toBe(0);
    await expect(itinerary.reorder([{ id: a.id, sort_order: -1 }])).rejects.toThrow(/Invalid position/);
    await expect(itinerary.reorder([{ id: 'ghost', sort_order: 1 }])).rejects.toThrow(/no longer exists/);
  });
});

describe('travelers and trash', () => {
  it('removing a traveler is kept in Recently deleted, so it can be undone', async () => {
    const { t, jon } = await setup();
    const gone = await travelers.remove(jon);
    expect(gone.summary).toBe('Traveler “Jon”');
    expect((await trash.list()).map((e) => [e.kind, e.label])).toEqual([['Traveler', 'Jon']]);
    await trash.restore(gone.id);
    expect((await loadTrip(t.id)).travelers.map((x) => x.name).sort()).toEqual(['Jon', 'Me']);
  });
});
