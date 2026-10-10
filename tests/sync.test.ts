/** Two phones sharing one trip by passing files: first import, updates both ways, deletions, undo, documents and safety. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/api/db';
import { documents, expenses, loadTrip, rows, tasks, travelers, trash, trips } from '../src/api/api';
import { exportData, importTrips, parseBackup } from '../src/api/backup';
import { importFile, planImport } from '../src/api/merge';

let michelle: IDBFactory;
let mom: IDBFactory;
const use = (device: IDBFactory) => { closeDb(); globalThis.indexedDB = device; };
const tick = () => new Promise((r) => setTimeout(r, 6)); // keep edits on the two phones in distinct milliseconds
beforeEach(() => { michelle = new IDBFactory(); mom = new IDBFactory(); use(michelle); });

const exp = (paid: string, cents: number, description = 'Taxi') => ({ paid_by: paid, description, amount_cents: cents, currency: 'USD', expense_date: '2027-06-13', category: 'Transportation', notes: '', itinerary_item_id: '', split_method: 'equal' as const });
const noMe = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'is_me' || k === 'me' ? undefined : x)));

/** Michelle's phone: a trip with two travelers, two items, a note, an expense and a document. */
async function michellesTrip() {
  use(michelle);
  const t = await trips.create({ name: 'Puerto Rico', start_date: '2027-06-12', end_date: '2027-06-16' }, ['Michelle', 'Mom'], ['San Juan']);
  const d = await loadTrip(t.id);
  const [me, mm] = d.travelers.map((x) => x.id);
  const flight = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'Flight', local_date: '2027-06-12' });
  await rows.insert('itinerary_items', { trip_id: t.id, title: 'Beach', local_date: '2027-06-13' });
  const note = await rows.insert<{ id: string }>('notes', { trip_id: t.id, scope: 'trip', target_id: null, body: 'Bring cash' });
  await expenses.save(t.id, null, exp(me, 4000), [{ user_id: me, amount_cents: 2000, share_value: null }, { user_id: mm, amount_cents: 2000, share_value: null }]);
  await documents.upload(t.id, new File([new Uint8Array([1, 2, 3, 4])], 'ticket.pdf', { type: 'application/pdf' }), {});
  return { tripId: t.id, me, mm, flightId: flight.id, noteId: note.id };
}
/** Open a file on a phone, as the Import button would (merging into a trip that is already there). */
const deliver = async (file: Awaited<ReturnType<typeof sendFrom>>, to: IDBFactory, mode: 'merge' | 'copy' = 'merge') => { use(to); return importFile(file, mode); };
const sendFrom = async (device: IDBFactory, tripId: string) => { use(device); return parseBackup(JSON.stringify(await exportData({ tripId, includeFiles: true }))); };

describe('first import on another phone', () => {
  it('adds the trip with its identity, so a later file can update it', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    use(mom);
    const plan = await planImport(file);
    expect(plan).toEqual([{ id: s.tripId, name: 'Puerto Rico', existing: false, merge: null }]);
    const r = await importFile(file, 'merge');
    expect(r.added).toEqual([{ id: s.tripId, name: 'Puerto Rico' }]);
    const d = await loadTrip(s.tripId); // same id on both phones
    expect([d.items.length, d.expenses.length, d.documents.length, d.notes.length]).toEqual([2, 1, 1, 1]);
    expect(await documents.openUrl(d.documents[0].id)).toBeTruthy(); // the file came along
  });
  it('refuses to keep an identity that collides with rows stored under another trip, adding a separate copy instead', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    use(mom);
    const other = await trips.create({ name: 'Other', start_date: '2027-01-01', end_date: '2027-01-02' }, ['X'], []);
    // forge a collision: a file whose item has the same id as an item that already belongs to "Other"
    const mine = await rows.insert<{ id: string }>('itinerary_items', { trip_id: other.id, title: 'Mine', local_date: '2027-01-01' });
    const forged = structuredClone(file);
    forged.tables.itinerary_items[0].id = mine.id;
    const r = await importFile(forged, 'merge');
    expect(r.copied).toHaveLength(1);
    expect(r.added).toHaveLength(0);
    expect((await loadTrip(other.id)).items.map((i) => i.title)).toEqual(['Mine']); // untouched
  });
});

describe('updating a trip you already have', () => {
  it('brings over what the other phone added, changed and deleted, and nothing else', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await tick();
    // Mom: adds an expense, renames an item, deletes the note, adds a to-do
    const momData = await loadTrip(s.tripId);
    await expenses.save(s.tripId, null, exp(s.mm, 1500, 'Groceries'), [{ user_id: s.me, amount_cents: 750, share_value: null }, { user_id: s.mm, amount_cents: 750, share_value: null }]);
    await rows.update('itinerary_items', momData.items.find((i) => i.title === 'Beach')!.id, { title: 'Beach day' });
    await rows.remove('notes', s.noteId);
    await tasks.add(s.tripId, 'Print tickets', '');
    const fileFromMom = await sendFrom(mom, s.tripId);

    use(michelle);
    const plan = (await planImport(fileFromMom))[0];
    expect(plan.existing).toBe(true);
    expect(plan.merge).toMatchObject({ added: 2, updated: 1, removed: 1 }); // expense + to-do, renamed item, deleted note
    const before = await loadTrip(s.tripId);
    expect(before.expenses).toHaveLength(1); // previewing changed nothing

    const r = await importFile(fileFromMom, 'merge');
    expect(r.merged[0].summary).toMatchObject({ added: 2, updated: 1, removed: 1 });
    const after = await loadTrip(s.tripId);
    expect(after.expenses.map((e) => e.description).sort()).toEqual(['Groceries', 'Taxi']);
    expect(after.items.map((i) => i.title).sort()).toEqual(['Beach day', 'Flight']);
    expect(after.notes).toHaveLength(0);
    expect(after.tasks.map((x) => x.title)).toEqual(['Print tickets']);
    expect(after.travelers.find((x) => x.id === s.me)!.is_me).toBe(true); // "me" stays me
    expect((await trips.list())).toHaveLength(1); // no duplicate trip
  });

  it('a second import of the same file changes nothing ("already up to date")', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    use(mom); await importFile(file, 'merge');
    const plan = (await planImport(file))[0];
    expect(plan.merge).toMatchObject({ added: 0, updated: 0, removed: 0 });
    const before = noMe(await loadTrip(s.tripId));
    const r = await importFile(file, 'merge');
    expect(r.merged[0].summary).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(noMe(await loadTrip(s.tripId))).toEqual(before);
  });

  it('things removed by an update land in Recently deleted and can be restored', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await tick();
    await rows.remove('notes', s.noteId);
    const fromMom = await sendFrom(mom, s.tripId);
    use(michelle);
    await importFile(fromMom, 'merge');
    expect((await loadTrip(s.tripId)).notes).toHaveLength(0);
    const entry = (await trash.list()).find((e) => e.kind === 'Update')!;
    expect(entry.label).toBe('1 item removed by an update');
    await trash.restore(entry.id);
    expect((await loadTrip(s.tripId)).notes.map((n) => n.body)).toEqual(['Bring cash']);
  });

  it('after both phones edit different things and swap files, both show the same trip', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await tick();
    // both phones edit at the same time, without seeing each other's changes
    use(michelle);
    await rows.insert('itinerary_items', { trip_id: s.tripId, title: 'Museum', local_date: '2027-06-14' });
    await rows.update('notes', s.noteId, { body: 'Bring cash and ID' });
    await expenses.save(s.tripId, null, exp(s.me, 900, 'Coffee'), [{ user_id: s.me, amount_cents: 450, share_value: null }, { user_id: s.mm, amount_cents: 450, share_value: null }]);
    await tick();
    use(mom);
    const momItems = (await loadTrip(s.tripId)).items;
    await rows.update('itinerary_items', momItems.find((i) => i.title === 'Flight')!.id, { title: 'Flight AA100' });
    await rows.insert('itinerary_items', { trip_id: s.tripId, title: 'Old San Juan walk', local_date: '2027-06-15' });
    await rows.remove('itinerary_items', momItems.find((i) => i.title === 'Beach')!.id);
    await tick();
    const fileM = await sendFrom(michelle, s.tripId);
    const fileO = await sendFrom(mom, s.tripId);
    use(michelle); await importFile(fileO, 'merge');
    use(mom); await importFile(fileM, 'merge');
    const a = await (async () => { use(michelle); return noMe(await loadTrip(s.tripId)); })();
    const b = await (async () => { use(mom); return noMe(await loadTrip(s.tripId)); })();
    expect(a).toEqual(b);
    expect(a.items.map((i: { title: string }) => i.title).sort()).toEqual(['Flight AA100', 'Museum', 'Old San Juan walk']);
    expect(a.notes[0].body).toBe('Bring cash and ID');
    expect(a.expenses).toHaveLength(2);
  });

  it('the newer edit wins when both phones changed the same thing', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await tick();
    use(michelle); await rows.update('notes', s.noteId, { body: 'Michelle first' });
    await tick();
    use(mom); await rows.update('notes', s.noteId, { body: 'Mom second' });
    await tick();
    const fileM = await sendFrom(michelle, s.tripId);
    const fileO = await sendFrom(mom, s.tripId);
    use(michelle); await importFile(fileO, 'merge');
    use(mom); await importFile(fileM, 'merge');
    use(michelle); expect((await loadTrip(s.tripId)).notes[0].body).toBe('Mom second');
    use(mom); expect((await loadTrip(s.tripId)).notes[0].body).toBe('Mom second');
  });

  it('keeps expenses balanced: the same total and splits on both phones after a merge', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await expenses.save(s.tripId, null, exp(s.mm, 3001, 'Dinner'), [{ user_id: s.me, amount_cents: 1500, share_value: null }, { user_id: s.mm, amount_cents: 1501, share_value: null }]);
    const fromMom = await sendFrom(mom, s.tripId);
    use(michelle); await importFile(fromMom, 'merge');
    for (const e of (await loadTrip(s.tripId)).expenses) expect(e.expense_splits.reduce((n, p) => n + p.amount_cents, 0)).toBe(e.amount_cents);
  });

  it('a traveler added on one phone appears on the other, never as "me"', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await travelers.add(s.tripId, 'Jon');
    const fromMom = await sendFrom(mom, s.tripId);
    use(michelle); await importFile(fromMom, 'merge');
    const d = await loadTrip(s.tripId);
    expect(d.travelers.map((t) => t.name).sort()).toEqual(['Jon', 'Michelle', 'Mom']);
    expect(d.travelers.filter((t) => t.is_me).map((t) => t.name)).toEqual(['Michelle']);
  });

  it('syncs a new document and its file, and a deleted one', async () => {
    const s = await michellesTrip();
    await deliver(await sendFrom(michelle, s.tripId), mom);
    await tick();
    const mine = (await loadTrip(s.tripId)).documents[0];
    await documents.remove(mine);
    await documents.upload(s.tripId, new File([new Uint8Array([9, 9])], 'receipt.png', { type: 'image/png' }), {});
    const fromMom = await sendFrom(mom, s.tripId);
    use(michelle); await importFile(fromMom, 'merge');
    const d = await loadTrip(s.tripId);
    expect(d.documents.map((x) => x.file_name)).toEqual(['receipt.png']);
    const url = await documents.openUrl(d.documents[0].id);
    expect(url).toBeTruthy();
  });
});

describe('adding a separate copy instead', () => {
  it('"copy" keeps both: the original is untouched and the copy has fresh ids', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    const before = noMe(await loadTrip(s.tripId));
    const r = await importFile(file, 'copy');
    expect(r.copied).toHaveLength(1);
    expect(r.copied[0].id).not.toBe(s.tripId);
    expect((await trips.list()).map((t) => t.name).sort()).toEqual(['Puerto Rico', 'Puerto Rico (copy)']);
    expect(noMe(await loadTrip(s.tripId))).toEqual(before);
  });
  it('the plain importTrips (used by Copy this trip) still always makes fresh copies', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    const [id] = await importTrips(file);
    expect(id).not.toBe(s.tripId);
  });
});

describe('files from before this feature', () => {
  it('a trip file without stamps or deletion lists still imports, and merging it changes nothing newer', async () => {
    const s = await michellesTrip();
    const file = await sendFrom(michelle, s.tripId);
    const old = structuredClone(file);
    delete old.tombstones;
    for (const t of Object.values(old.tables)) for (const r of t) delete r.updated_at;
    use(mom);
    await importFile(old, 'merge'); // new to mom: added
    await tick();
    await rows.update('notes', s.noteId, { body: 'Mom edited' });
    await importFile(old, 'merge'); // merging the old, unstamped file must not undo her edit
    expect((await loadTrip(s.tripId)).notes[0].body).toBe('Mom edited');
  });
});
