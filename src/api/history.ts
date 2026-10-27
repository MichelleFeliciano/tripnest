/** Undo, Redo and the History list. Entries are recorded by the data layer (db.ts) in the same transaction as each change. */
import { transaction, TABLES, type HistoryEntry, type StoreName } from './db';
import { ApiError, friendly } from './api';
import { sameContent } from '../lib/history';

const STORES: StoreName[] = [...TABLES, 'history'];
const byId = (a: HistoryEntry, b: HistoryEntry) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface HistoryState {
  /** Newest first, for the History list. */
  entries: HistoryEntry[];
  /** What Undo would reverse, or null. */
  undo: HistoryEntry | null;
  /** What Redo would re-apply, or null. */
  redo: HistoryEntry | null;
  /** Set when the newest step can't be undone (a delete or import), so the screen can say where to go instead. */
  undoBlockedBy: string | null;
}

export function summarize(all: HistoryEntry[]): HistoryState {
  const sorted = [...all].sort(byId);
  const done = sorted.filter((e) => e.state === 'done');
  const top = done[done.length - 1] ?? null;
  const next = sorted.find((e) => e.state === 'undone') ?? null; // oldest undone step = the next one to redo
  return {
    entries: sorted.reverse(),
    undo: top && top.undoable ? top : null,
    redo: next,
    undoBlockedBy: top && !top.undoable ? top.label : null,
  };
}

export const history = {
  state: async (): Promise<HistoryState> => {
    try { return summarize(await transaction(['history'], 'readonly', (x) => x.historyAll())); } catch { return summarize([]); }
  },

  /** Reverse the newest change. Returns what was undone. */
  undo: async (): Promise<string> => {
    try {
      return await transaction(STORES, 'readwrite', async (x) => {
        const { undo, undoBlockedBy } = summarize(await x.historyAll());
        if (!undo) throw new ApiError(undoBlockedBy ? `“${undoBlockedBy}” can’t be undone here. Use Recently deleted on the Profile page, or a backup.` : 'There is nothing to undo.');
        for (const c of [...undo.changes].reverse()) {
          if (!sameContent((await x.get(c.table, c.id)) ?? null, c.after)) throw new ApiError('That was changed again afterwards, so it can’t be undone safely.');
          if (c.before) await x.put(c.table, c.before); else await x.del(c.table, c.id);
        }
        await x.historyPut({ ...undo, state: 'undone' });
        return undo.label;
      }, { journal: false });
    } catch (e) { throw friendly(e); }
  },

  /** Re-apply the change that was last undone. */
  redo: async (): Promise<string> => {
    try {
      return await transaction(STORES, 'readwrite', async (x) => {
        const { redo } = summarize(await x.historyAll());
        if (!redo) throw new ApiError('There is nothing to redo.');
        for (const c of redo.changes) {
          if (!sameContent((await x.get(c.table, c.id)) ?? null, c.before)) throw new ApiError('Something changed in the meantime, so this can’t be redone.');
          if (c.after) await x.put(c.table, c.after); else await x.del(c.table, c.id);
        }
        await x.historyPut({ ...redo, state: 'done' });
        return redo.label;
      }, { journal: false });
    } catch (e) { throw friendly(e); }
  },
};
