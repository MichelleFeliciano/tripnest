import { describeChange, sameContent } from '../lib/history';
/**
 * On-device storage. All trip data lives in this browser's IndexedDB and never leaves the device.
 * Every table is an object store keyed by `id`; child tables are indexed by `trip_id`.
 * Multi-table changes run in ONE transaction, so a cascade either fully happens or not at all.
 */
export const TABLES = [
  'trips', 'travelers', 'destinations', 'itinerary_items', 'reservations', 'packing_categories',
  'packing_items', 'expenses', 'settlements', 'budgets', 'notes', 'documents', 'tasks',
] as const;
export type Table = (typeof TABLES)[number];

/** A deleted item (or whole trip) kept for 30 days so it can be restored. Not part of backups. */
export interface TrashEntry {
  id: string;
  /** e.g. "Expense", "Trip" */
  kind: string;
  label: string;
  trip_id: string;
  trip_name: string;
  deleted_at: string;
  /** every row that was removed, including children (a trip carries its whole contents) */
  rows: { table: Table; row: Row }[];
  /** uploaded files that belonged to removed documents */
  blobs: { id: string; blob: Blob }[];
  /** references that were cleared on other rows by the delete, so a restore can put them back */
  unlinks: { table: Table; id: string; field: string; value: string }[];
}
/** One recorded change to a row, kept so it can be undone and redone. `before` is null for a new row, `after` is null for a removed one. */
export interface HistoryChange { table: Table; id: string; before: Row | null; after: Row | null }
/** A step in the History list: everything one action changed, saved together. */
export interface HistoryEntry {
  id: string;
  at: string;
  label: string;
  trip_id: string | null;
  state: 'done' | 'undone';
  /** False for deletes, imports and restores of backups: they have their own way back (Recently deleted, a backup). */
  undoable: boolean;
  changes: HistoryChange[];
}
export const HISTORY_LIMIT = 100;
export type StoreName = Table | 'blobs' | 'trash' | 'history';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any> & { id: string };

export class StorageUnavailableError extends Error {
  constructor() {
    super('This browser is not allowing TripNest to save data (private browsing or blocked storage). Open it in a normal window.');
  }
}

const DB_NAME = 'tripnest';
const DB_VERSION = 3; // v2 adds the "tasks" and "trash" stores; v3 adds "history"
let dbPromise: Promise<IDBDatabase> | null = null;

/** Forget the open connection (tests, and after a full wipe). */
export function closeDb(): void {
  dbPromise?.then((d) => d.close()).catch(() => undefined);
  dbPromise = null;
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new StorageUnavailableError());
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return reject(new StorageUnavailableError()); }
    // Runs for a brand-new database (creates everything) and for an upgrade from an older version
    // (creates only what is missing; existing stores and their data are never touched).
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) {
        if (db.objectStoreNames.contains(t)) continue;
        const store = db.createObjectStore(t, { keyPath: 'id' });
        if (t !== 'trips') store.createIndex('trip_id', 'trip_id');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' }); // uploaded documents
      if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' }); // recently deleted
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' }); // undo / redo
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new StorageUnavailableError());
    req.onblocked = () => reject(new Error('Another TripNest tab is blocking a storage update. Close other TripNest tabs and reload.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export interface Tx {
  all(t: Table): Promise<Row[]>;
  byTrip(t: Table, tripId: string): Promise<Row[]>;
  get(t: Table, id: string): Promise<Row | undefined>;
  /** Saves a row and stamps it `updated_at: now` (this is what lets two copies of a trip be merged later). */
  put(t: Table, row: Row): Promise<void>;
  /** Saves a row exactly as given, keeping its own `updated_at` (restoring a backup, importing, merging). */
  putAsIs(t: Table, row: Row): Promise<void>;
  del(t: Table, id: string): Promise<void>;
  clear(t: Table | 'blobs' | 'trash' | 'history'): Promise<void>;
  historyAll(): Promise<HistoryEntry[]>;
  historyPut(entry: HistoryEntry): Promise<void>;
  historyDel(id: string): Promise<void>;
  blobPut(id: string, blob: Blob): Promise<void>;
  blobGet(id: string): Promise<Blob | undefined>;
  blobDel(id: string): Promise<void>;
  blobIds(): Promise<string[]>;
  trashAll(): Promise<TrashEntry[]>;
  trashGet(id: string): Promise<TrashEntry | undefined>;
  trashPut(entry: TrashEntry): Promise<void>;
  trashDel(id: string): Promise<void>;
}

/**
 * Run `fn` inside a single transaction over `stores`. Throwing inside `fn` rolls everything back.
 * Writes to the data tables are also recorded in the History list (same transaction, so the two never disagree).
 * Pass `{ journal: false }` for work that must not appear there (undo itself, wiping the device).
 */
export async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (x: Tx) => Promise<T>, opts: { journal?: boolean } = {}): Promise<T> {
  const db = await open();
  const journal = mode === 'readwrite' && opts.journal !== false && stores.some((s) => (TABLES as readonly string[]).includes(s));
  const names = journal && !stores.includes('history') ? [...stores, 'history' as StoreName] : stores;
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(names, mode); } catch (e) { return reject(e); }
    let result: T;
    let rec: Recorder | null = null;
    t.oncomplete = () => { if (rec?.wrote) globalThis.dispatchEvent?.(new Event(HISTORY_EVENT)); resolve(result); };
    t.onabort = () => {
      const err = t.error ?? new Error('Storage transaction was cancelled');
      if ((err as { name?: string }).name === 'QuotaExceededError') globalThis.dispatchEvent?.(new Event(STORAGE_FULL_EVENT));
      reject(err);
    };
    t.onerror = () => { /* surfaced through onabort */ };
    const raw: Tx = {
      all: (s) => req(t.objectStore(s).getAll()) as Promise<Row[]>,
      byTrip: (s, id) => req(t.objectStore(s).index('trip_id').getAll(id)) as Promise<Row[]>,
      get: (s, id) => req(t.objectStore(s).get(id)) as Promise<Row | undefined>,
      put: async (s, row) => { await req(t.objectStore(s).put({ ...row, updated_at: new Date().toISOString() })); },
      putAsIs: async (s, row) => { await req(t.objectStore(s).put(row)); },
      del: async (s, id) => { await req(t.objectStore(s).delete(id)); },
      clear: async (s) => { await req(t.objectStore(s).clear()); },
      blobPut: async (id, blob) => { await req(t.objectStore('blobs').put({ id, blob })); },
      blobGet: async (id) => ((await req(t.objectStore('blobs').get(id))) as { blob: Blob } | undefined)?.blob,
      blobDel: async (id) => { await req(t.objectStore('blobs').delete(id)); },
      blobIds: async () => (await req(t.objectStore('blobs').getAllKeys())) as string[],
      trashAll: () => req(t.objectStore('trash').getAll()) as Promise<TrashEntry[]>,
      trashGet: (id) => req(t.objectStore('trash').get(id)) as Promise<TrashEntry | undefined>,
      trashPut: async (entry) => { await req(t.objectStore('trash').put(entry)); },
      trashDel: async (id) => { await req(t.objectStore('trash').delete(id)); },
      historyAll: () => req(t.objectStore('history').getAll()) as Promise<HistoryEntry[]>,
      historyPut: async (entry) => { await req(t.objectStore('history').put(entry)); },
      historyDel: async (id) => { await req(t.objectStore('history').delete(id)); },
    };
    rec = journal ? new Recorder(raw) : null;
    const x = rec ? rec.tx : raw;
    fn(x).then(async (r) => { if (rec) await rec.flush(); result = r; }).catch((e) => {
      try { t.abort(); } catch { /* already finished */ }
      reject(e);
    });
  });
}

/** Fired after a change was added to the History list, so Undo / Redo buttons can refresh. */
export const HISTORY_EVENT = 'tripnest:history-changed';
/** Fired when the browser refuses a save because the device is out of space. */
export const STORAGE_FULL_EVENT = 'tripnest:storage-full';

let seq = 0;
const newHistoryId = () => `${Date.now().toString().padStart(14, '0')}-${String(++seq % 1000).padStart(3, '0')}`;

/** Wraps a transaction's writes so the History list can describe and reverse them. */
class Recorder {
  private changes = new Map<string, HistoryChange>();
  private barrier: string | null = null;
  private restored: string | null = null;
  readonly tx: Tx;
  wrote = false;
  constructor(private raw: Tx) {
    this.tx = {
      ...raw,
      put: async (t, row) => {
        const before = (await raw.get(t, row.id)) ?? null;
        const after = { ...row, updated_at: new Date().toISOString() };
        await raw.putAsIs(t, after);
        const key = `${t}/${row.id}`;
        const prior = this.changes.get(key);
        this.changes.set(key, { table: t, id: row.id, before: prior ? prior.before : before, after });
      },
      putAsIs: async (t, row) => { this.barrier ??= 'Imported or merged data'; await raw.putAsIs(t, row); },
      del: async (t, id) => { this.barrier ??= 'Removed data'; await raw.del(t, id); },
      clear: async (s) => { if (s !== 'trash' && s !== 'blobs' && s !== 'history') this.barrier ??= 'Replaced all data'; await raw.clear(s); },
      trashPut: async (e) => { this.barrier = `Deleted ${e.kind} “${e.label}”`; await raw.trashPut(e); },
      trashDel: async (id) => { const e = await raw.trashGet(id); if (e) this.restored = `Restored ${e.kind} “${e.label}”`; await raw.trashDel(id); },
    };
  }

  async flush(): Promise<void> {
    const real = [...this.changes.values()].filter((c) => !sameContent(c.before, c.after));
    if (real.length === 0 && !this.barrier) return;
    const all = await this.raw.historyAll();
    for (const e of all) if (e.state === 'undone') await this.raw.historyDel(e.id); // a new action ends the Redo chain
    const keep = all.filter((e) => e.state === 'done').sort((a, b) => (a.id < b.id ? -1 : 1));
    if (this.barrier) for (const e of keep) if (e.undoable) await this.raw.historyPut({ ...e, undoable: false, changes: [] });
    const primary = real.find((c) => c.table === 'trips') ?? real[0];
    const label = this.barrier ?? this.restored ?? describeChange(primary.table, primary.before, primary.after, real.length - 1);
    const tripId = primary ? (primary.table === 'trips' ? primary.id : String((primary.after ?? primary.before)?.trip_id ?? '') || null) : null;
    this.wrote = true;
    await this.raw.historyPut({ id: newHistoryId(), at: new Date().toISOString(), label, trip_id: tripId, state: 'done', undoable: !this.barrier, changes: this.barrier ? [] : real });
    const total = keep.length + 1;
    for (const e of keep.slice(0, Math.max(0, total - HISTORY_LIMIT))) await this.raw.historyDel(e.id);
  }
}

/** Ask the browser not to evict our data under storage pressure (best effort, silent). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export async function storageEstimate(): Promise<{ usedBytes: number; quotaBytes: number; persistent: boolean } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usedBytes: e.usage ?? 0, quotaBytes: e.quota ?? 0, persistent: (await navigator.storage.persisted?.()) ?? false };
  } catch { return null; }
}
