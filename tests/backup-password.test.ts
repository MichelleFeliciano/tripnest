/** Password-protected backups: encryption round-trip, wrong passwords, tampering, and the open/restore flow. */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../src/api/db';
import { loadTrip, trips } from '../src/api/api';
import { exportData, importTrips, makeBackupText, openBackup, parseBackup, restoreAll } from '../src/api/backup';
import { WrongPasswordError, decryptBackup, encryptBackup, isEncryptedBackup, passwordProblem } from '../src/api/crypto';

beforeEach(() => { closeDb(); globalThis.indexedDB = new IDBFactory(); });
const FAST = 1_000; // few rounds so the tests run quickly; the real default is 600,000

describe('encryption', () => {
  it('round-trips text, including accents, emoji and a very long string', async () => {
    for (const plain of ['', 'hello', 'Café ☕ 日本語 🌴', 'x'.repeat(2_000_000)]) {
      const locked = await encryptBackup(plain, 'correct horse', FAST);
      expect(await decryptBackup(locked, 'correct horse')).toBe(plain);
    }
  });
  it('hides the content, and gives a different file every time', async () => {
    const a = await encryptBackup('{"secret":"Hotel El Convento"}', 'correct horse', FAST);
    const b = await encryptBackup('{"secret":"Hotel El Convento"}', 'correct horse', FAST);
    expect(a).not.toContain('Hotel');
    expect(a).not.toBe(b); // fresh salt and nonce
    expect(isEncryptedBackup(a)).toBe(true);
  });
  it('refuses a wrong password, a tampered file and cut-off data, all as a wrong-password error', async () => {
    const locked = await encryptBackup('private', 'correct horse', FAST);
    await expect(decryptBackup(locked, 'wrong password')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBackup(locked, '')).rejects.toBeInstanceOf(WrongPasswordError);
    const env = JSON.parse(locked);
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    await expect(decryptBackup(JSON.stringify({ ...env, data: flip(env.data) }), 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBackup(JSON.stringify({ ...env, data: env.data.slice(0, -8) }), 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(decryptBackup(JSON.stringify({ ...env, iv: flip(env.iv) }), 'correct horse')).rejects.toBeInstanceOf(WrongPasswordError);
  });
  it('treats the same password typed with different unicode forms as the same', async () => {
    const locked = await encryptBackup('private', 'café-password', FAST); // é as one character
    expect(await decryptBackup(locked, 'café-password')).toBe('private'); // é as e + accent
  });
  it('rejects a crafted file instead of freezing or crashing', async () => {
    const env = JSON.parse(await encryptBackup('x', 'correct horse', FAST));
    for (const bad of [{ iterations: 2_000_000_000 }, { iterations: 1 }, { iterations: 'many' }, { salt: 'AAAA' }, { kdf: 'MD5' }, { encrypted: false }, { data: 5 }]) {
      await expect(decryptBackup(JSON.stringify({ ...env, ...bad }), 'correct horse')).rejects.toThrow();
    }
    await expect(decryptBackup('not json', 'x')).rejects.toThrow(/couldn't be read/);
  });
  it('requires a sensible password to lock a file', async () => {
    expect(passwordProblem('short')).toMatch(/at least 8/);
    expect(passwordProblem('long enough')).toBeNull();
    await expect(encryptBackup('x', 'short', FAST)).rejects.toThrow(/at least 8/);
  });
});

describe('protected backups end to end', () => {
  async function seed() {
    const t = await trips.create({ name: 'Secret Trip', start_date: '2027-06-12', end_date: '2027-06-14' }, ['Me', 'Jon'], ['Ponce']);
    await trips.update(t.id, { key_info: 'Gate B7' });
    return t;
  }

  it('saves a protected file that does not reveal the trip, and opens it only with the password', async () => {
    const t = await seed();
    const text = await makeBackupText(await exportData({ includeFiles: false }), 'correct horse');
    expect(text).not.toContain('Secret Trip');
    expect(() => parseBackup(text)).toThrow(/password protected/i); // the plain parser never mistakes it for a bad file
    const asked: boolean[] = [];
    const file = await openBackup(text, async (wasWrong) => { asked.push(wasWrong); return wasWrong ? 'correct horse' : 'oops wrong'; });
    expect(asked).toEqual([false, true]); // first try wrong, second right
    expect(file!.tables.trips[0].id).toBe(t.id);
  });
  it('gives up cleanly when the person cancels the password box, and changes nothing', async () => {
    await seed();
    const text = await makeBackupText(await exportData({ includeFiles: false }), 'correct horse');
    expect(await openBackup(text, async () => null)).toBeNull();
    expect((await trips.list()).length).toBe(1);
  });
  it('a plain file opens without ever asking for a password', async () => {
    await seed();
    const text = await makeBackupText(await exportData({ includeFiles: false }), null);
    const file = await openBackup(text, async () => { throw new Error('should not ask'); });
    expect(file!.tables.trips).toHaveLength(1);
  });
  it('restores everything, and imports a single trip, from a protected file', async () => {
    const t = await seed();
    const text = await makeBackupText(await exportData({ includeFiles: false }), 'correct horse');
    closeDb(); globalThis.indexedDB = new IDBFactory(); // a new phone
    const file = (await openBackup(text, async () => 'correct horse'))!;
    await restoreAll(file);
    const back = await loadTrip(t.id);
    expect([back.trip.name, back.trip.key_info, back.travelers.length]).toEqual(['Secret Trip', 'Gate B7', 2]);
    const ids = await importTrips(file);
    expect(ids).toHaveLength(1);
    expect((await trips.list()).map((x) => x.name).sort()).toEqual(['Secret Trip', 'Secret Trip (copy)']);
  });
});
