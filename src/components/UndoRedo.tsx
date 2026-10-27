import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly } from '../api/api';
import { HISTORY_EVENT } from '../api/db';
import { history, type HistoryState } from '../api/history';
import { announceDataChanged, useToast } from './Toast';

const EMPTY: HistoryState = { entries: [], undo: null, redo: null, undoBlockedBy: null };
const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/** Undo and Redo for edits, plus a link to the History list. Also answers Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z outside text fields. */
export default function UndoRedo({ showHistoryLink = true }: { showHistoryLink?: boolean }) {
  const [s, setS] = useState<HistoryState>(EMPTY);
  const toast = useToast();
  const refresh = useCallback(() => { void history.state().then(setS); }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(HISTORY_EVENT, refresh);
    return () => window.removeEventListener(HISTORY_EVENT, refresh);
  }, [refresh]);

  const run = useCallback(async (kind: 'undo' | 'redo') => {
    try {
      const label = await history[kind]();
      announceDataChanged();
      toast.say(`${kind === 'undo' ? 'Undid' : 'Redid'}: ${label}.`);
    } catch (e) { toast.say(friendly(e).message); }
    refresh();
  }, [refresh, toast]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); void run('undo'); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); void run('redo'); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [run]);

  return (
    <div className="row undo-bar no-print" role="group" aria-label="Undo and redo">
      <button className="btn btn-sm" disabled={!s.undo} onClick={() => void run('undo')} title={s.undo ? `Undo: ${s.undo.label}` : 'Nothing to undo'}>↶ Undo</button>
      <button className="btn btn-sm" disabled={!s.redo} onClick={() => void run('redo')} title={s.redo ? `Redo: ${s.redo.label}` : 'Nothing to redo'}>↷ Redo</button>
      {showHistoryLink && <Link className="btn btn-sm btn-ghost" to="/history">History</Link>}
    </div>
  );
}
