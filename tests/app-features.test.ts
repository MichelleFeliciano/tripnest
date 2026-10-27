/** Versioning, What's new, storage warnings, text size / theme, app lock, and Undo / Redo / History. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, transaction } from '../src/api/db';
import { loadTrip, rows, tasks, trips } from '../src/api/api';
import { exportData } from '../src/api/backup';
import { history } from '../src/api/history';
import { applyPrefs, getPrefs, setPrefs } from '../src/api/prefs';
import { getLock, isLockOn, lockDelayMs, removeLock, secretProblem, setAutoLock, setLock, shouldRelock, unlock, waitSeconds } from '../src/api/lock';
import { APP_VERSION, CHANGELOG, compareVersions, entriesSince, parseChangelog } from '../src/lib/changelog';
import { percentUsed, storageLevel } from '../src/lib/storage';
import { sameContent } from '../src/lib/history';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
beforeEach(() => {
  closeDb();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

describe('versions and the change log', () => {
  it('the newest change-log entry is the version in package.json, with a real date', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
    expect(CHANGELOG[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const e of CHANGELOG) expect(e.notes.length).toBeGreaterThan(0);
  });
  it('lists versions newest first, strictly decreasing', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBe(1);
  });
  it('parses headings and notes', () => {
    const e = parseChangelog('# Changelog\n\n## 2.0.0 - 2027-01-02\n- one\n- two\n\n## 1.9.10 - 2026-12-31\n- old\n');
    expect(e).toEqual([{ version: '2.0.0', date: '2027-01-02', notes: ['one', 'two'] }, { version: '1.9.10', date: '2026-12-31', notes: ['old'] }]);
  });
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });
  it("shows what's new since the last seen version, never newer than the one running", () => {
    const e = parseChangelog('## 1.3.0 - 2027-03-01\n- c\n## 1.2.0 - 2027-02-01\n- b\n## 1.1.0 - 2027-01-01\n- a\n');
    expect(entriesSince(e, '1.1.0', '1.3.0').map((x) => x.version)).toEqual(['1.3.0', '1.2.0']);
    expect(entriesSince(e, null, '1.3.0').map((x) => x.version)).toEqual(['1.3.0']);
    expect(entriesSince(e, '1.3.0', '1.3.0')).toEqual([]);
    expect(entriesSince(e, '1.1.0', '1.2.0').map((x) => x.version)).toEqual(['1.2.0']);
  });
  it('writes the app version into backup files', async () => {
    const f = await exportData({ includeFiles: false });
    expect(f.appVersion).toBe(APP_VERSION);
    expect(f.format).toBe(1);
  });
});

describe('storage warning', () => {
  it('warns from 80% and again from 95%', () => {
    expect(storageLevel(10, 100)).toBe('ok');
    expect(storageLevel(80, 100)).toBe('low');
    expect(storageLevel(94, 100)).toBe('low');
    expect(storageLevel(95, 100)).toBe('full');
    expect(storageLevel(5, 0)).toBe('unknown');
    expect(percentUsed(50, 200)).toBe(25);
    expect(percentUsed(500, 200)).toBe(100);
  });
});

describe('theme and text size', () => {
  const fakeRoot = () => { const attrs: Record<string, string> = {}; return { attrs, style: { fontSize: '' }, setAttribute: (k: string, v: string) => { attrs[k] = v; }, removeAttribute: (k: string) => { delete attrs[k]; } } as unknown as HTMLElement & { attrs: Record<string, string> }; };
  it('defaults to automatic theme and normal text', () => { expect(getPrefs()).toEqual({ theme: 'auto', textSize: 'normal' }); });
  it('applies and remembers a manual theme and a larger text size', () => {
    const root = fakeRoot();
    applyPrefs({ theme: 'dark', textSize: 'large' }, root);
    expect(root.attrs['data-theme']).toBe('dark');
    expect(root.style.fontSize).toBe('115%');
    applyPrefs({ theme: 'auto', textSize: 'normal' }, root);
    expect(root.attrs['data-theme']).toBeUndefined();
    expect(root.style.fontSize).toBe('');
    setPrefs({ textSize: 'xlarge' });
    expect(getPrefs().textSize).toBe('xlarge');
  });
  it('ignores junk in storage', () => {
    localStorage.setItem('tripnest:prefs', '{"theme":"neon","textSize":"huge"}');
    expect(getPrefs()).toEqual({ theme: 'auto', textSize: 'normal' });
  });
});

describe('app lock', () => {
  it('checks what a PIN or password must look like', () => {
    expect(secretProblem('pin', '123')).not.toBeNull();
    expect(secretProblem('pin', '12ab')).not.toBeNull();
    expect(secretProblem('pin', '1234')).toBeNull();
    expect(secretProblem('password', 'short')).not.toBeNull();
    expect(secretProblem('password', 'long enough')).toBeNull();
  });
  it('stores only a hash, and opens with the right PIN only', async () => {
    expect(isLockOn()).toBe(false);
    await setLock('pin', '4821', 5);
    expect(isLockOn()).toBe(true);
    expect(localStorage.getItem('tripnest:lock')).not.toContain('4821');
    expect(await unlock('0000')).toBe('wrong');
    expect(await unlock('4821')).toBe('ok');
    expect(getLock()?.autoLockMinutes).toBe(5);
    setAutoLock(0);
    expect(getLock()?.autoLockMinutes).toBe(0);
    removeLock();
    expect(isLockOn()).toBe(false);
  });
  it('slows down guessing after five wrong tries, and a right one still has to wait', async () => {
    await setLock('password', 'correct horse');
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(await unlock('nope nope', t0)).toBe('wrong');
    expect(await unlock('nope nope', t0)).toBe('wait');
    expect(waitSeconds(t0)).toBe(30);
    expect(await unlock('correct horse', t0 + 1000)).toBe('wait');
    expect(await unlock('correct horse', t0 + 31_000)).toBe('ok');
    expect(waitSeconds(t0 + 31_000)).toBe(0);
  });
  it('waits longer after each further failure, up to an hour', () => {
    expect([4, 5, 6, 7].map(lockDelayMs)).toEqual([0, 30_000, 60_000, 120_000]);
    expect(lockDelayMs(50)).toBe(3_600_000);
  });
  it('locks again only after the chosen time away', () => {
    expect(shouldRelock(0, 59_000, 1)).toBe(false);
    expect(shouldRelock(0, 60_000, 1)).toBe(true);
    expect(shouldRelock(0, 1, 0)).toBe(true);
  });
});

describe('undo, redo and history', () => {
  async function setup() {
    const t = await trips.create({ name: 'Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me'], []);
    return t;
  }
  const titles = async (id: string) => (await loadTrip(id)).tasks.map((x) => x.title).sort();

  it('records each change as one step with a readable label', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Book hotel', '');
    const s = await history.state();
    expect(s.entries[0].label).toBe('Added to-do “Book hotel”');
    expect(s.entries[1].label).toBe('Added trip “Trip” (+1 related)');
    expect(s.undo?.id).toBe(s.entries[0].id);
    expect(s.redo).toBeNull();
  });

  it('undoes an addition and redoes it', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Book hotel', '');
    expect(await history.undo()).toBe('Added to-do “Book hotel”');
    expect(await titles(t.id)).toEqual([]);
    expect((await history.state()).redo?.label).toBe('Added to-do “Book hotel”');
    await history.redo();
    expect(await titles(t.id)).toEqual(['Book hotel']);
  });

  it('undoes an edit back to the earlier values', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Pack', '');
    const id = (await loadTrip(t.id)).tasks[0].id;
    await tasks.toggle(id, true);
    expect((await loadTrip(t.id)).tasks[0].done).toBe(true);
    await history.undo();
    expect((await loadTrip(t.id)).tasks[0].done).toBe(false);
    await history.redo();
    expect((await loadTrip(t.id)).tasks[0].done).toBe(true);
  });

  it('undoes step by step, newest first, and a new change ends the redo chain', async () => {
    const t = await setup();
    await tasks.add(t.id, 'A', '');
    await tasks.add(t.id, 'B', '');
    await history.undo();
    await history.undo();
    expect(await titles(t.id)).toEqual([]);
    await history.redo(); // oldest first
    expect(await titles(t.id)).toEqual(['A']);
    await tasks.add(t.id, 'C', '');
    expect((await history.state()).redo).toBeNull();
    expect(await titles(t.id)).toEqual(['A', 'C']);
  });

  it('puts the edit back with a fresh stamp so a later merge treats it as the newest change', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Pack', '');
    const before = (await loadTrip(t.id)).tasks[0];
    await tasks.toggle(before.id, true);
    await history.undo();
    const after = (await loadTrip(t.id)).tasks[0];
    expect(Date.parse(after.updated_at!)).toBeGreaterThanOrEqual(Date.parse(before.updated_at!));
    expect(sameContent(after as never, before as never)).toBe(true);
  });

  it('refuses to undo a step whose row was changed in some other way since', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Pack', '');
    const id = (await loadTrip(t.id)).tasks[0].id;
    await transaction(['tasks'], 'readwrite', async (x) => { const r = (await x.get('tasks', id))!; await x.putAsIs('tasks', { ...r, title: 'Changed behind its back' }); }, { journal: false });
    await expect(history.undo()).rejects.toThrow(/changed again/);
  });

  it('a delete has its own undo, so history stops at it', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Keep', '');
    await tasks.add(t.id, 'Drop', '');
    const drop = (await loadTrip(t.id)).tasks.find((x) => x.title === 'Drop')!;
    await tasks.remove(drop.id);
    const s = await history.state();
    expect(s.entries[0].label).toBe('Deleted To-do “Drop”');
    expect(s.undo).toBeNull();
    expect(s.undoBlockedBy).toBe('Deleted To-do “Drop”');
    expect(s.entries.every((e) => !e.undoable)).toBe(true);
    await expect(history.undo()).rejects.toThrow(/Recently deleted/);
    await tasks.add(t.id, 'After', ''); // history works again for new changes
    expect((await history.state()).undo?.label).toBe('Added to-do “After”');
  });

  it('does not record a save that changed nothing', async () => {
    const t = await setup();
    await tasks.add(t.id, 'Same', '');
    const n = (await history.state()).entries.length;
    const row = (await loadTrip(t.id)).tasks[0];
    await rows.update('tasks', row.id, { title: 'Same' });
    expect((await history.state()).entries.length).toBe(n);
  });

  it('keeps only the most recent 100 steps', async () => {
    const t = await setup();
    for (let i = 0; i < 105; i++) await tasks.add(t.id, `T${i}`, '');
    const s = await history.state();
    expect(s.entries.length).toBe(100);
    expect(s.entries[0].label).toBe('Added to-do “T104”');
  });

  it('is not part of a backup', async () => {
    const t = await setup();
    await tasks.add(t.id, 'x', '');
    const f = await exportData({ includeFiles: false });
    expect(JSON.stringify(f)).not.toContain('"undoable"');
  });
});
