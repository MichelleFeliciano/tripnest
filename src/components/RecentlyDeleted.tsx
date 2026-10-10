import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TRASH_DAYS, friendly, trash } from '../api/api';
import type { TrashEntry } from '../api/db';
import { useAction } from '../hooks/hooks';
import { DATA_CHANGED, announceDataChanged, useToast } from './Toast';
import { ErrorBanner } from './ui';

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const daysLeft = (e: TrashEntry) => Math.max(0, Math.ceil(TRASH_DAYS - (Date.now() - Date.parse(e.deleted_at)) / 86_400_000));

/** Anything deleted in the last 30 days, with a one-tap restore. */
export default function RecentlyDeleted() {
  const [list, setList] = useState<TrashEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const act = useAction();
  const toast = useToast();

  const load = useCallback(() => trash.list().then(setList).catch((e) => setLoadError(friendly(e).message)), []);
  useEffect(() => {
    void load();
    window.addEventListener(DATA_CHANGED, load);
    return () => window.removeEventListener(DATA_CHANGED, load);
  }, [load]);

  const restore = async (e: TrashEntry) => {
    const r = await act.run(() => trash.restore(e.id));
    if (r) { announceDataChanged(); toast.say(`Restored ${r.summary}.`); await load(); }
  };
  const discard = async (e: TrashEntry) => {
    if (!window.confirm(`Delete “${e.label}” for good? This cannot be undone.`)) return;
    const ok = await act.run(async () => { await trash.discard(e.id); return true; });
    if (ok) await load();
  };
  const empty = async () => {
    if (!window.confirm('Permanently delete everything in Recently deleted? This cannot be undone.')) return;
    const ok = await act.run(async () => { await trash.empty(); return true; });
    if (ok) await load();
  };

  return (
    <section className="card" aria-labelledby="rd-h">
      <h2 id="rd-h">Recently deleted</h2>
      <p className="muted">Deleted trips and items are kept here for {TRASH_DAYS} days so you can bring them back.</p>
      <ErrorBanner message={act.error ?? loadError} />
      {list === null ? null : list.length === 0 ? <p>Nothing deleted recently.</p> : (
        <>
          <ul className="list">
            {list.map((e) => {
              const bytes = e.blobs.reduce((a, b) => a + b.blob.size, 0);
              return (
                <li key={e.id} className="row-between">
                  <div>
                    <strong>{e.kind}: {e.label}</strong>
                    <div className="muted">
                      {e.kind === 'Trip' ? '' : `from ${e.trip_name} · `}deleted {new Date(e.deleted_at).toLocaleDateString()} · {daysLeft(e)} {daysLeft(e) === 1 ? 'day' : 'days'} left{bytes ? ` · ${size(bytes)}` : ''}
                    </div>
                  </div>
                  <div className="row">
                    <button className="btn btn-sm" onClick={() => restore(e)} disabled={act.busy} aria-label={`Restore ${e.kind} ${e.label}`}>Restore</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => discard(e)} disabled={act.busy} aria-label={`Delete ${e.kind} ${e.label} for good`}>Delete for good</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <button className="btn btn-sm btn-danger" onClick={empty} disabled={act.busy}>Empty recently deleted</button>
          <p className="muted">Restored trips appear on the <Link to="/trips">Trips</Link> page.</p>
        </>
      )}
    </section>
  );
}
