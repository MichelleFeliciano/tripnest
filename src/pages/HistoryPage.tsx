import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HISTORY_EVENT, HISTORY_LIMIT } from '../api/db';
import { history, type HistoryState } from '../api/history';
import UndoRedo from '../components/UndoRedo';
import { Empty } from '../components/ui';

/** Recent changes, newest first. Undo and Redo work from the top of this list. */
export default function HistoryPage() {
  const [s, setS] = useState<HistoryState | null>(null);
  useEffect(() => {
    const load = () => { void history.state().then(setS); };
    load();
    window.addEventListener(HISTORY_EVENT, load);
    window.addEventListener('tripnest:data-changed', load);
    return () => { window.removeEventListener(HISTORY_EVENT, load); window.removeEventListener('tripnest:data-changed', load); };
  }, []);

  return (
    <main className="container">
      <h1>History</h1>
      <p className="muted">The last {HISTORY_LIMIT} changes you made on this device. Undo reverses the newest one; Redo puts it back. Deleted things are kept for 30 days under <Link to="/profile">Profile → Recently deleted</Link>.</p>
      <UndoRedo showHistoryLink={false} />
      {s?.undoBlockedBy && <p className="muted">The newest step, “{s.undoBlockedBy}”, can’t be undone here, and neither can anything before it. Use Recently deleted or a backup instead.</p>}
      {s && s.entries.length === 0 ? <Empty title="No changes yet">Things you add, edit or tick off will show up here.</Empty> : (
        <ol className="list card history-list" reversed>
          {s?.entries.map((e) => (
            <li key={e.id} className={e.state === 'undone' ? 'history-undone' : undefined}>
              <strong>{e.label}</strong>
              <div className="muted">
                {new Date(e.at).toLocaleString()}
                {e.state === 'undone' && ' · undone (Redo brings it back)'}
                {!e.undoable && ' · can’t be undone here'}
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
