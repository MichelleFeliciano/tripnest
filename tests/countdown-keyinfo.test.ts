/** The countdown wording and the pinned key-info note (validation, backup, copy). */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { countdown } from '../src/lib/countdown';
import { closeDb } from '../src/api/db';
import { loadTrip, trips } from '../src/api/api';
import { exportData, parseBackup } from '../src/api/backup';
import { copyTrip } from '../src/api/copyTrip';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });

describe('countdown', () => {
  const c = (today: string) => countdown('2027-06-12', '2027-06-14', today);
  it('counts down to the start', () => {
    expect(c('2027-06-11')).toEqual({ phase: 'before', text: 'Starts tomorrow' });
    expect(c('2027-06-02')).toEqual({ phase: 'before', text: 'Starts in 10 days' });
    expect(c('2027-01-01').text).toBe('Starts in 162 days');
  });
  it('counts days during the trip, naming the last one', () => {
    expect(c('2027-06-12')).toEqual({ phase: 'during', text: 'Day 1 of 3' });
    expect(c('2027-06-13').text).toBe('Day 2 of 3');
    expect(c('2027-06-14').text).toBe('Last day (day 3 of 3)');
  });
  it('says how long ago it ended', () => {
    expect(c('2027-06-15')).toEqual({ phase: 'after', text: 'Ended yesterday' });
    expect(c('2027-06-20').text).toBe('Ended 6 days ago');
  });
  it('handles a one-day trip and month/year/leap boundaries', () => {
    expect(countdown('2027-06-12', '2027-06-12', '2027-06-12').text).toBe('Today is the day');
    expect(countdown('2028-03-01', '2028-03-03', '2028-02-28').text).toBe('Starts in 2 days'); // 2028 has a 29 Feb
    expect(countdown('2027-01-02', '2027-01-04', '2026-12-31').text).toBe('Starts in 2 days');
    expect(countdown('2027-01-01', '2027-01-02', '2027-01-01').text).toBe('Day 1 of 2');
  });
});

describe('key info', () => {
  const make = () => trips.create({ name: 'Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me'], []);

  it('saves, trims, clears and survives a reload', async () => {
    const t = await make();
    await trips.update(t.id, { key_info: '  Hotel: 100 Calle del Cristo\nMom +1 512 555 0123  ' });
    expect((await loadTrip(t.id)).trip.key_info).toBe('Hotel: 100 Calle del Cristo\nMom +1 512 555 0123');
    await trips.update(t.id, { key_info: '   ' });
    expect((await loadTrip(t.id)).trip.key_info).toBeNull();
  });
  it('refuses text over 2,000 characters and keeps what was there', async () => {
    const t = await make();
    await trips.update(t.id, { key_info: 'keep me' });
    await expect(trips.update(t.id, { key_info: 'x'.repeat(2001) })).rejects.toThrow(/too long/);
    expect((await loadTrip(t.id)).trip.key_info).toBe('keep me');
    await trips.update(t.id, { key_info: 'x'.repeat(2000) });
  });
  it('is part of a backup, and a backup with bad key info is refused', async () => {
    const t = await make();
    await trips.update(t.id, { key_info: 'Gate B7' });
    const file = await exportData({ includeFiles: false });
    expect(parseBackup(JSON.stringify(file)).tables.trips[0].key_info).toBe('Gate B7');
    for (const bad of [42, { a: 1 }, 'y'.repeat(2001)]) {
      const broken = structuredClone(file);
      broken.tables.trips[0].key_info = bad;
      expect(() => parseBackup(JSON.stringify(broken))).toThrow(/key info/i);
    }
    const older = structuredClone(file); // backups made before this feature have no key_info at all
    delete older.tables.trips[0].key_info;
    expect(() => parseBackup(JSON.stringify(older))).not.toThrow();
  });
  it('is left behind when a trip is copied as a template', async () => {
    const t = await make();
    await trips.update(t.id, { key_info: 'Flight WN 1234' });
    const copy = await loadTrip(await copyTrip(t.id, { name: 'Next', startDate: '2028-06-12', itinerary: true, packing: true, todo: true, budget: true, notes: true }));
    expect(copy.trip.key_info ?? null).toBeNull();
    expect((await loadTrip(t.id)).trip.key_info).toBe('Flight WN 1234');
  });
});
