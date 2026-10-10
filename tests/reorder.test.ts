/** Moving itinerary items up and down within a day. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/api/db';
import { itinerary, loadTrip, rows, trips } from '../src/api/api';
import { itemLike } from '../src/api/adapters';
import { canMove, moveWithinGroup, orderGroup, sortItems, type ItemLike } from '../src/lib/itinerary';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });

const it_ = (id: string, o: Partial<ItemLike> = {}): ItemLike => ({ id, title: id, itemType: 'activity', localDate: '2027-06-13', startAt: null, startTz: null, endAt: null, endTz: null, sortOrder: 0, ...o });
const apply = (items: ItemLike[], ups: { id: string; sort_order: number }[]) => items.map((i) => ({ ...i, sortOrder: ups.find((u) => u.id === i.id)?.sort_order ?? i.sortOrder }));
const order = (items: ItemLike[]) => sortItems(items).map((i) => i.id);

describe('moveWithinGroup', () => {
  const day = [it_('a'), it_('b'), it_('c'), it_('t1', { startAt: '2027-06-13T14:00:00Z' }), it_('other-day', { localDate: '2027-06-14' })];

  it('groups only items that sort as equals: untimed ones, or the same start moment', () => {
    expect(orderGroup(day, 'b').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(orderGroup(day, 't1').map((i) => i.id)).toEqual(['t1']);
    const same = [it_('x', { startAt: '2027-06-13T14:00:00Z' }), it_('y', { startAt: '2027-06-13T14:00:00.000Z' }), it_('z', { startAt: '2027-06-13T15:00:00Z' })];
    expect(orderGroup(same, 'x').map((i) => i.id)).toEqual(['x', 'y']);
  });

  it('cannot move past the ends, or an item that is alone at its time', () => {
    expect(canMove(day, 'a', -1)).toBe(false);
    expect(canMove(day, 'a', 1)).toBe(true);
    expect(canMove(day, 'c', 1)).toBe(false);
    expect(canMove(day, 't1', -1)).toBe(false);
    expect(canMove(day, 't1', 1)).toBe(false);
    expect(moveWithinGroup(day, 'a', -1)).toEqual([]);
    expect(canMove(day, 'nope', 1)).toBe(false);
  });

  it('swaps with the neighbour, renumbers the group, and leaves every other item alone', () => {
    const ups = moveWithinGroup(day, 'b', -1);
    expect(ups.map((u) => u.id).sort()).toEqual(['a', 'b', 'c']);
    expect(order(apply(day, ups)).slice(0, 4)).toEqual(['b', 'a', 'c', 't1']);
  });

  it('moving down then up restores the order, even from all-equal starting numbers', () => {
    let items = day;
    items = apply(items, moveWithinGroup(items, 'a', 1));
    expect(order(items).slice(0, 3)).toEqual(['b', 'a', 'c']);
    items = apply(items, moveWithinGroup(items, 'a', -1));
    expect(order(items).slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('every item can be walked to the top, one step at a time', () => {
    let items = [it_('a'), it_('b'), it_('c'), it_('d')];
    for (let n = 0; n < 3; n++) items = apply(items, moveWithinGroup(items, 'd', -1));
    expect(order(items)).toEqual(['d', 'a', 'b', 'c']);
    expect(canMove(items, 'd', -1)).toBe(false);
  });
});

describe('itinerary.reorder (stored)', () => {
  it('saves the new order and it survives a reload', async () => {
    const t = await trips.create({ name: 'T', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me'], []);
    for (const title of ['Alpha', 'Beta', 'Gamma']) await rows.insert('itinerary_items', { trip_id: t.id, title, local_date: '2027-06-13' });
    let items = (await loadTrip(t.id)).items.map(itemLike);
    expect(order(items).map((id) => items.find((i) => i.id === id)!.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const gamma = items.find((i) => i.title === 'Gamma')!;
    await itinerary.reorder(moveWithinGroup(items, gamma.id, -1));
    items = (await loadTrip(t.id)).items.map(itemLike);
    expect(order(items).map((id) => items.find((i) => i.id === id)!.title)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });

  it('rejects a missing item and applies nothing', async () => {
    const t = await trips.create({ name: 'T', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me'], []);
    const a = await rows.insert<{ id: string }>('itinerary_items', { trip_id: t.id, title: 'A', local_date: '2027-06-13' });
    await expect(itinerary.reorder([{ id: a.id, sort_order: 5 }, { id: 'missing', sort_order: 1 }])).rejects.toThrow(/no longer exists/);
    expect((await loadTrip(t.id)).items[0].sort_order).toBe(0);
  });
});
