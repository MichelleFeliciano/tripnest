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
export type StoreName = Table | 'blobs' | 'trash';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any> & { id: string };

export class StorageUnavailableError extends Error {
  constructor() {
    super('This browser is not allowing TripNest to save data (private browsing or blocked storage). Open it in a normal window.');
  }
}

const DB_NAME = 'tripnest';
const DB_VERSION = 2; // v2 adds the "tasks" and "trash" stores
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
  clear(t: Table | 'blobs' | 'trash'): Promise<void>;
  blobPut(id: string, blob: Blob): Promise<void>;
  blobGet(id: string): Promise<Blob | undefined>;
  blobDel(id: string): Promise<void>;
  blobIds(): Promise<string[]>;
  trashAll(): Promise<TrashEntry[]>;
  trashGet(id: string): Promise<TrashEntry | undefined>;
  trashPut(entry: TrashEntry): Promise<void>;
  trashDel(id: string): Promise<void>;
}

/** Run `fn` inside a single transaction over `stores`. Throwing inside `fn` rolls everything back. */
export async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (x: Tx) => Promise<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try { t = db.transaction(stores, mode); } catch (e) { return reject(e); }
    let result: T;
    let failed = false;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('Storage transaction was cancelled'));
    t.onerror = () => { /* surfaced through onabort */ };
    const x: Tx = {
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
    };
    fn(x).then((r) => { result = r; }).catch((e) => {
      failed = true;
      try { t.abort(); } catch { /* already finished */ }
      reject(e);
    });
    void failed;
  });
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
