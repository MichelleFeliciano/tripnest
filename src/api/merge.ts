/**
 * Importing a trip file, including merging it into a copy of the same trip that is already on this device.
 * The rules for what wins live in src/lib/merge.ts (pure and tested); this file reads, previews and applies them.
 */
import { friendly } from './api';
import { base64ToBlob, writeTrip, type BackupFile } from './backup';
import { TABLES, transaction, type Row, type StoreName, type Table, type Tx, type TrashEntry } from './db';
import { emptyRows, mergeTrip, type MergeSummary, type RowsByTable, type Tombstone } from '../lib/merge';
import { uuid } from '../lib/uuid';

const ALL: StoreName[] = [...TABLES, 'blobs', 'trash'];

export interface PlannedTrip {
  id: string;
  name: string;
  /** This device already has this exact trip (same identity), so the file can update it instead of adding a copy. */
  existing: boolean;
  /** What updating would change, when `existing`. */
  merge: MergeSummary | null;
}
export interface ImportResult {
  /** Trips that were new to this device. */
  added: { id: string; name: string }[];
  /** Trips that were updated from the file. */
  merged: { id: string; name: string; summary: MergeSummary }[];
  /** Trips added as separate copies. */
  copied: { id: string; name: string }[];
}

const incomingRows = (file: BackupFile, tripId: string): RowsByTable => {
  const out = emptyRows();
  for (const t of TABLES) out[t] = file.tables[t].filter((r) => (t === 'trips' ? r.id === tripId : r.trip_id === tripId));
  return out;
};

async function localRows(x: Tx, tripId: string): Promise<RowsByTable> {
  const out = emptyRows();
  const trip = await x.get('trips', tripId);
  if (trip) out.trips = [trip];
  for (const t of TABLES) if (t !== 'trips') out[t] = await x.byTrip(t, tripId);
  return out;
}

async function localTombstones(x: Tx, tripId: string): Promise<Tombstone[]> {
  return (await x.trashAll()).filter((e) => e.trip_id === tripId).flatMap((e) => e.rows.filter((r) => r.table !== 'trips').map((r) => ({ table: r.table, id: r.row.id, deleted_at: e.deleted_at })));
}

/** Rows in the file that would collide with rows already stored under a different trip: then it cannot keep its identity. */
async function collides(x: Tx, file: BackupFile, tripId: string): Promise<boolean> {
  for (const t of TABLES) {
    if (t === 'trips') continue;
    for (const r of file.tables[t]) if (r.trip_id === tripId && await x.get(t, r.id)) return true;
  }
  return false;
}

/** Looks at a file without changing anything: which trips are new here and, for ones already here, what an update would change. */
export async function planImport(file: BackupFile): Promise<PlannedTrip[]> {
  try {
    return await transaction(ALL, 'readonly', async (x) => {
      const out: PlannedTrip[] = [];
      for (const trip of file.tables.trips) {
        const mine = await x.get('trips', trip.id);
        if (!mine) { out.push({ id: trip.id, name: String(trip.name), existing: false, merge: null }); continue; }
        const result = mergeTrip({
          tripId: trip.id, local: await localRows(x, trip.id), incoming: incomingRows(file, trip.id),
          incomingTombstones: file.tombstones ?? [], localTombstones: await localTombstones(x, trip.id), now: new Date().toISOString(),
        });
        out.push({ id: trip.id, name: String(trip.name), existing: true, merge: result.summary });
      }
      return out;
    });
  } catch (e) { throw friendly(e); }
}

/**
 * Brings the file's trips onto this device.
 *  - a trip this device does not have is added and keeps its identity (so later files from it can update it)
 *  - a trip this device already has is merged into, or added as a separate copy, as chosen
 * All of it happens in one step: if anything fails, nothing changes.
 */
export async function importFile(file: BackupFile, whenExisting: 'merge' | 'copy'): Promise<ImportResult> {
  try {
    return await transaction(ALL, 'readwrite', async (x) => {
      const names = new Set((await x.all('trips')).map((t) => String(t.name).toLowerCase()));
      const result: ImportResult = { added: [], merged: [], copied: [] };
      for (const trip of file.tables.trips) {
        const exists = !!(await x.get('trips', trip.id));
        if (!exists) {
          const keep = !(await collides(x, file, trip.id));
          const id = await writeTrip(x, file, trip, keep, names);
          (keep ? result.added : result.copied).push({ id, name: String(trip.name) });
        } else if (whenExisting === 'copy') {
          result.copied.push({ id: await writeTrip(x, file, trip, false, names), name: String(trip.name) });
        } else {
          result.merged.push({ id: trip.id, name: String((await x.get('trips', trip.id))?.name ?? trip.name), summary: await applyMerge(x, file, trip.id) });
        }
      }
      return result;
    });
  } catch (e) { throw friendly(e); }
}

async function applyMerge(x: Tx, file: BackupFile, tripId: string): Promise<MergeSummary> {
  const now = new Date().toISOString();
  const res = mergeTrip({
    tripId, local: await localRows(x, tripId), incoming: incomingRows(file, tripId),
    incomingTombstones: file.tombstones ?? [], localTombstones: await localTombstones(x, tripId), now,
  });
  for (const { table, row } of res.puts) {
    await x.putAsIs(table, row); // rows keep their own stamps (rows the repair step changed were stamped with `now`)
    const f = table === 'documents' ? file.files[row.id] : undefined;
    if (f) await x.blobPut(row.id, base64ToBlob(f.data, f.type));
  }
  if (res.removes.length) {
    // Anything the update removes goes to Recently deleted, so it can be brought back.
    const blobs: { id: string; blob: Blob }[] = [];
    for (const { table, row } of res.removes) {
      if (table === 'documents') { const blob = await x.blobGet(row.id); if (blob) blobs.push({ id: row.id, blob }); await x.blobDel(row.id); }
      await x.del(table as Table, row.id);
    }
    const trip = await x.get('trips', tripId);
    const entry: TrashEntry = {
      id: uuid(), kind: 'Update', label: `${res.removes.length} ${res.removes.length === 1 ? 'item' : 'items'} removed by an update`,
      trip_id: tripId, trip_name: String(trip?.name ?? ''), deleted_at: now, rows: res.removes.map((r) => ({ table: r.table, row: r.row as Row })), blobs, unlinks: [],
    };
    await x.trashPut(entry);
  }
  return res.summary;
}
