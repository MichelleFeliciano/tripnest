/**
 * Backups and trip files. Data lives only on this device, so a backup file is the safety net
 * (browser data can be cleared, phones get replaced) and also the way to move a trip to another device.
 *  - exportData(): everything, or one trip, as a JSON file (documents optionally included)
 *  - restoreAll(): replace everything on this device with a backup
 *  - importTrip(): add the trips in a file as NEW copies (fresh ids), never overwriting anything
 */
import { transaction, TABLES, type Row, type StoreName, type Table, type Tx } from './db';
import { friendly, ApiError } from './api';
import { getSettings, saveSettings, type Settings } from './settings';
import { TRIP_STATUSES, isValidIsoDate, validateTrip } from '../lib/trip';
import { BUDGET_CATEGORIES, EXPENSE_CATEGORIES } from '../lib/budget';
import { isValidTimeZone } from '../lib/time';
import { ITEM_TYPES } from '../lib/itinerary';
import { uuid } from '../lib/uuid';
import { WrongPasswordError, decryptBackup, encryptBackup, isEncryptedBackup } from './crypto';

export const BACKUP_FORMAT = 1;
export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;

export interface BackupFile {
  app: 'tripnest';
  format: number;
  exportedAt: string;
  settings?: Settings;
  tables: Record<Table, Row[]>;
  files: Record<string, { type: string; data: string }>; // document id -> base64
  /** Single-trip files only: what was deleted from the trip recently, so a merge on another device can delete it there too. */
  tombstones?: { table: Table; id: string; deleted_at: string }[];
}

// ───────── base64 ─────────
async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

const ALL: StoreName[] = [...TABLES, 'blobs', 'trash'];

/** Everything (tripId omitted) or a single trip. */
export async function exportData(opts: { tripId?: string; includeFiles: boolean }): Promise<BackupFile> {
  try {
    // Read everything in ONE transaction, but do no slow work inside it: a browser closes a transaction as soon
    // as the code awaits anything that is not a database request (such as converting a file to base64).
    const { tables, blobs, tombstones } = await transaction(ALL, 'readonly', async (x) => {
      const tables = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<Table, Row[]>;
      if (opts.tripId) {
        const trip = await x.get('trips', opts.tripId);
        if (!trip) throw new ApiError('That trip no longer exists.');
        tables.trips = [trip];
        for (const t of TABLES) if (t !== 'trips') tables[t] = await x.byTrip(t, opts.tripId);
      } else {
        for (const t of TABLES) tables[t] = await x.all(t);
      }
      const blobs: { id: string; type: string; blob: Blob }[] = [];
      if (opts.includeFiles) {
        for (const d of tables.documents) {
          const blob = await x.blobGet(d.id);
          if (blob) blobs.push({ id: d.id, type: d.mime_type, blob });
        }
      }
      // Recent deletions from this trip travel with the file so another copy of the trip can apply them when it merges.
      const tombstones = opts.tripId
        ? (await x.trashAll()).filter((e) => e.trip_id === opts.tripId).flatMap((e) => e.rows.filter((r) => r.table !== 'trips').map((r) => ({ table: r.table, id: r.row.id, deleted_at: e.deleted_at })))
        : undefined;
      return { tables, blobs, tombstones };
    });
    const files: BackupFile['files'] = {};
    for (const b of blobs) files[b.id] = { type: b.type, data: await blobToBase64(b.blob) };
    return { app: 'tripnest', format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), settings: opts.tripId ? undefined : getSettings(), tables, files, ...(tombstones ? { tombstones } : {}) };
  } catch (e) { throw friendly(e); }
}

export const backupFileName = (name?: string) =>
  `tripnest-${(name ?? 'backup').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip'}-${new Date().toISOString().slice(0, 10)}.json`;

// ───────── validation ─────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isMoney = (n: unknown, min = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= 1e11;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isCode = (v: unknown) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
const instant = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
const RESERVATION_KINDS = ['flight', 'hotel', 'restaurant', 'activity', 'car_rental', 'other'];

/** The text to save or share: the plain file, or the same file locked with a password. */
export async function makeBackupText(file: BackupFile, password: string | null): Promise<string> {
  const plain = JSON.stringify(file);
  return password ? encryptBackup(plain, password) : plain;
}

/**
 * Opens a backup or trip file's text. A password-protected file asks for the password (as many times as it takes);
 * returns null if the person gives up.
 */
export async function openBackup(text: string, askPassword: (wasWrong: boolean) => Promise<string | null>): Promise<BackupFile | null> {
  if (!isEncryptedBackup(text)) return parseBackup(text);
  let wasWrong = false;
  for (;;) {
    const password = await askPassword(wasWrong);
    if (password === null) return null;
    try { return parseBackup(await decryptBackup(text, password)); }
    catch (e) { if (e instanceof WrongPasswordError) { wasWrong = true; continue; } throw e; }
  }
}

/** Parse and structurally validate a backup/trip file. Throws ApiError with a plain-language reason. */
export function parseBackup(text: string): BackupFile {
  if (isEncryptedBackup(text)) throw new ApiError('This backup is password protected. Open it with Restore or Import so you can enter the password.');
  if (text.length > MAX_BACKUP_BYTES) throw new ApiError('That file is too large to be a TripNest backup.');
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new ApiError("That file isn't a TripNest backup (it couldn't be read)."); }
  if (!isObj(j) || j.app !== 'tripnest') throw new ApiError("That file isn't a TripNest backup.");
  if (j.format !== BACKUP_FORMAT) throw new ApiError('That backup was made by a different version of TripNest and cannot be opened here.');
  if (!isObj(j.tables)) throw new ApiError('That backup is missing its data.');
  const tables = {} as Record<Table, Row[]>;
  const ids = new Set<string>();
  for (const t of TABLES) {
    const arr = (j.tables as Record<string, unknown>)[t] ?? [];
    if (!Array.isArray(arr) || arr.length > 200_000) throw new ApiError(`That backup has a damaged "${t}" section.`);
    for (const r of arr) {
      if (!isObj(r) || !isId(r.id)) throw new ApiError(`That backup has a damaged entry in "${t}".`);
      if (t !== 'trips' && !isId(r.trip_id)) throw new ApiError(`That backup has an entry in "${t}" without a trip.`);
      if (ids.has(`${t}:${r.id}`)) throw new ApiError(`That backup has duplicate entries in "${t}".`);
      ids.add(`${t}:${r.id}`);
    }
    tables[t] = arr as Row[];
  }
  for (const tr of tables.trips) {
    const problems = validateTrip({ name: String(tr.name ?? ''), startDate: String(tr.start_date ?? ''), endDate: String(tr.end_date ?? '') });
    if (problems.length) throw new ApiError(`A trip in that backup is invalid: ${problems[0]}.`);
    if (!TRIP_STATUSES.includes(tr.status) || !isCode(tr.default_currency) || !Number.isInteger(tr.budget_near_pct) || tr.budget_near_pct < 1 || tr.budget_near_pct > 100) {
      throw new ApiError('A trip in that backup is invalid: its status, currency or budget setting is not recognised.');
    }
  }
  for (const tr of tables.trips) if (tr.key_info != null && (typeof tr.key_info !== 'string' || tr.key_info.length > 2000)) throw new ApiError('A trip in that backup is invalid: its key info is not valid text.');
  const tripIds = new Set(tables.trips.map((t) => t.id));
  for (const t of TABLES) for (const r of tables[t]) if (t !== 'trips' && !tripIds.has(r.trip_id)) throw new ApiError(`That backup has "${t}" entries that belong to no trip.`);
  for (const r of tables.itinerary_items) {
    if (typeof r.title !== 'string' || !isValidIsoDate(r.local_date) || !ITEM_TYPES.includes(r.item_type)) throw new ApiError('An itinerary item in that backup is invalid.');
    if ((r.start_at && !isValidTimeZone(r.start_tz)) || (r.end_at && !isValidTimeZone(r.end_tz))) throw new ApiError('An itinerary time in that backup has an invalid time zone.');
    if (!instant(r.start_at) || !instant(r.end_at)) throw new ApiError('An itinerary item in that backup has a time that is not a real date and time.');
    if (r.cost_cents !== null && r.cost_cents !== undefined && (!isMoney(r.cost_cents) || !isCode(r.currency))) throw new ApiError('An itinerary item in that backup has an invalid cost.');
  }
  for (const r of tables.reservations) {
    if (typeof r.title !== 'string' || !RESERVATION_KINDS.includes(r.kind) || !instant(r.starts_at) || !instant(r.ends_at) || !isObj(r.details)
      || (r.starts_at && !isValidTimeZone(r.starts_tz)) || (r.ends_at && !isValidTimeZone(r.ends_tz))) throw new ApiError('A reservation in that backup is invalid.');
  }
  for (const r of tables.destinations) {
    const num = (v: unknown, max: number) => v === null || v === undefined || (typeof v === 'number' && Math.abs(v) <= max);
    const date = (v: unknown) => v === null || v === undefined || isValidIsoDate(String(v));
    if (typeof r.name !== 'string' || !num(r.latitude, 90) || !num(r.longitude, 180) || !date(r.arrival_date) || !date(r.departure_date)) throw new ApiError('A destination in that backup is invalid.');
  }
  for (const r of tables.travelers) if (typeof r.name !== 'string' || typeof r.is_me !== 'boolean') throw new ApiError('A traveler in that backup is invalid.');
  for (const r of tables.packing_categories) if (typeof r.name !== 'string' || typeof r.is_shared !== 'boolean') throw new ApiError('A packing category in that backup is invalid.');
  for (const r of tables.packing_items) {
    if (typeof r.name !== 'string' || typeof r.is_shared !== 'boolean' || typeof r.packed !== 'boolean' || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999) throw new ApiError('A packing item in that backup is invalid.');
  }
  for (const r of tables.budgets) {
    if ((r.category !== null && !BUDGET_CATEGORIES.includes(r.category)) || !isMoney(r.amount_cents) || !isCode(r.currency)) throw new ApiError('A budget in that backup is invalid.');
  }
  for (const r of tables.tasks) {
    if (typeof r.title !== 'string' || typeof r.done !== 'boolean' || !(r.due_date === null || r.due_date === undefined || isValidIsoDate(String(r.due_date)))) throw new ApiError('A to-do in that backup is invalid.');
  }
  for (const r of tables.notes) if (!['trip', 'destination', 'itinerary', 'reservation'].includes(r.scope) || typeof r.body !== 'string') throw new ApiError('A note in that backup is invalid.');
  for (const r of tables.expenses) {
    const splits = r.expense_splits;
    if (typeof r.description !== 'string' || !isValidIsoDate(String(r.expense_date)) || !EXPENSE_CATEGORIES.includes(r.category) || !['equal', 'custom', 'percent', 'shares'].includes(r.split_method)) throw new ApiError('An expense in that backup is invalid.');
    if (!isMoney(r.amount_cents, 1) || !isCode(r.currency) || !isId(r.paid_by) || !Array.isArray(splits) || splits.length === 0 || !splits.every((s: unknown) => isObj(s) && isId(s.user_id) && isMoney(s.amount_cents))
      || splits.reduce((a: number, s: { amount_cents: number }) => a + s.amount_cents, 0) !== r.amount_cents) throw new ApiError('An expense in that backup is invalid (its split does not add up).');
  }
  for (const r of tables.settlements) {
    if (!isMoney(r.amount_cents, 1) || !isCode(r.currency) || !isId(r.from_user) || !isId(r.to_user) || r.from_user === r.to_user || !isValidIsoDate(String(r.settled_on))) throw new ApiError('A payment in that backup is invalid.');
  }
  const files: BackupFile['files'] = {};
  if (isObj(j.files)) {
    for (const [id, f] of Object.entries(j.files)) {
      if (isObj(f) && typeof f.data === 'string' && typeof f.type === 'string' && tables.documents.some((d) => d.id === id)) files[id] = { type: f.type, data: f.data };
    }
  }
  const settings = isObj(j.settings) && typeof j.settings.display_name === 'string' && typeof j.settings.home_timezone === 'string'
    ? { display_name: j.settings.display_name, home_timezone: j.settings.home_timezone } : undefined;
  let tombstones: BackupFile['tombstones'];
  if (j.tombstones !== undefined) {
    const list = j.tombstones;
    const ok = Array.isArray(list) && list.length <= 100_000 && list.every((t) => isObj(t) && (TABLES as readonly string[]).includes(String(t.table)) && isId(t.id) && typeof t.deleted_at === 'string' && Number.isFinite(Date.parse(t.deleted_at)));
    if (!ok) throw new ApiError('That file has a damaged list of deleted items.');
    tombstones = list as NonNullable<BackupFile['tombstones']>;
  }
  return { app: 'tripnest', format: BACKUP_FORMAT, exportedAt: String(j.exportedAt ?? ''), settings, tables, files, ...(tombstones ? { tombstones } : {}) };
}

// ───────── restore (replace everything) ─────────
export async function restoreAll(file: BackupFile): Promise<void> {
  try {
    await transaction(ALL, 'readwrite', async (x) => {
      for (const t of TABLES) await x.clear(t);
      await x.clear('blobs');
      await x.clear('trash'); // a restore replaces everything, including what was recently deleted
      for (const t of TABLES) for (const r of file.tables[t]) await x.putAsIs(t, r);
      for (const [id, f] of Object.entries(file.files)) await x.blobPut(id, base64ToBlob(f.data, f.type));
    });
    if (file.settings && isValidTimeZone(file.settings.home_timezone)) saveSettings(file.settings);
  } catch (e) { throw friendly(e); }
}

// ───────── import trips as copies ─────────
const FK: Partial<Record<Table, Record<string, Table>>> = {
  itinerary_items: { destination_id: 'destinations' },
  reservations: { itinerary_item_id: 'itinerary_items' },
  packing_categories: { owner_id: 'travelers' },
  packing_items: { category_id: 'packing_categories', assigned_to: 'travelers', owner_id: 'travelers' },
  expenses: { paid_by: 'travelers', itinerary_item_id: 'itinerary_items' },
  settlements: { from_user: 'travelers', to_user: 'travelers' },
  documents: { itinerary_item_id: 'itinerary_items', reservation_id: 'reservations' },
};

/**
 * Writes one trip (and everything in it) from a file into storage.
 *  keepIds true:  the trip keeps the identity it has in the file, so a later file from the same trip can be matched up and merged.
 *  keepIds false: an independent copy, every id fresh.
 */
export async function writeTrip(x: Tx, file: BackupFile, trip: Row, keepIds: boolean, existingNames: Set<string>): Promise<string> {
  const map: Partial<Record<Table, Map<string, string>>> = {};
  const newId = (t: Table, old: string) => {
    const m = (map[t] ??= new Map());
    if (!m.has(old)) m.set(old, keepIds ? old : uuid());
    return m.get(old)!;
  };
  const lookup = (t: Table, old: unknown) => (typeof old === 'string' && map[t]?.has(old) ? map[t]!.get(old)! : null);
  const mine = (t: Table) => file.tables[t].filter((r) => r.trip_id === trip.id);
  for (const t of TABLES) if (t !== 'trips') for (const r of mine(t)) newId(t, r.id);
  const tripId = keepIds ? trip.id : uuid();
  const name = !keepIds && existingNames.has(String(trip.name).toLowerCase()) ? `${trip.name} (copy)`.slice(0, 120) : trip.name;
  existingNames.add(String(name).toLowerCase());
  // Which traveler is "me" belongs to the device. If exactly one traveler has this device owner's name, that is them.
  const myName = getSettings().display_name.trim().toLowerCase();
  const sameName = myName ? mine('travelers').filter((r) => String(r.name).trim().toLowerCase() === myName) : [];
  await x.putAsIs('trips', { ...trip, id: tripId, name });
  for (const t of TABLES) {
    if (t === 'trips') continue;
    for (const r of mine(t)) {
      const row: Row = { ...r, id: map[t]!.get(r.id)!, trip_id: tripId };
      for (const [field, target] of Object.entries(FK[t] ?? {})) if (field in row) row[field] = lookup(target, row[field]);
      if (t === 'expenses') row.expense_splits = r.expense_splits.map((s: { user_id: string }) => ({ ...s, user_id: lookup('travelers', s.user_id) ?? s.user_id }));
      if (t === 'notes' && row.target_id) row.target_id = lookup(row.scope === 'destination' ? 'destinations' : row.scope === 'itinerary' ? 'itinerary_items' : 'reservations', row.target_id);
      if (t === 'travelers' && sameName.length === 1) row.is_me = r.id === sameName[0].id;
      await x.putAsIs(t, row);
      if (t === 'documents' && file.files[r.id]) await x.blobPut(row.id, base64ToBlob(file.files[r.id].data, file.files[r.id].type));
    }
  }
  return tripId;
}

/** Adds every trip in the file as a new copy with fresh ids. Returns the new trip ids. */
export async function importTrips(file: BackupFile): Promise<string[]> {
  try {
    return await transaction(ALL, 'readwrite', async (x) => {
      const existingNames = new Set((await x.all('trips')).map((t) => String(t.name).toLowerCase()));
      const created: string[] = [];
      for (const trip of file.tables.trips) created.push(await writeTrip(x, file, trip, false, existingNames));
      return created;
    });
  } catch (e) { throw friendly(e); }
}

/** Remove everything stored on this device (trips, documents, preferences). */
export async function eraseEverything(): Promise<void> {
  try {
    await transaction(ALL, 'readwrite', async (x) => { for (const t of TABLES) await x.clear(t); await x.clear('blobs'); await x.clear('trash'); });
    try { localStorage.removeItem('tripnest:settings'); } catch { /* ignore */ }
  } catch (e) { throw friendly(e); }
}
