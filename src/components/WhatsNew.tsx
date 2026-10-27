import { useEffect, useState } from 'react';
import { trips } from '../api/api';
import { getDevice, markVersionSeen } from '../api/device';
import { APP_VERSION, CHANGELOG, entriesSince, type ChangelogEntry } from '../lib/changelog';
import { formatDateShort } from '../lib/time';
import { Dialog } from './ui';

export function WhatsNewList({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div>
      {entries.map((e) => (
        <section key={e.version} aria-label={`Version ${e.version}`}>
          <h3>Version {e.version} <span className="muted">· {formatDateShort(e.date)}</span></h3>
          <ul>{e.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      ))}
    </div>
  );
}

/**
 * After an update, once: a quiet banner offering a short note of what changed (it never blocks the screen).
 * A brand-new install doesn't get one, because it has nothing to compare with.
 */
export default function WhatsNewOnUpdate() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const seen = getDevice().seen_version;
    if (seen === APP_VERSION) return;
    void trips.list().then((list) => {
      const fresh = seen === null && list.length === 0;
      const news = fresh ? [] : entriesSince(CHANGELOG, seen, APP_VERSION);
      if (news.length === 0) markVersionSeen(APP_VERSION); else setEntries(news);
    }).catch(() => undefined);
  }, []);
  const dismiss = () => { markVersionSeen(APP_VERSION); setOpen(false); setEntries([]); };
  if (entries.length === 0) return null;
  return (
    <>
      <div className="status-banner status-info no-print" role="status">
        <span><strong>TripNest was updated to version {APP_VERSION}.</strong></span>
        <span className="row">
          <button className="btn btn-sm" onClick={() => setOpen(true)}>See what’s new</button>
          <button className="btn btn-sm btn-ghost" onClick={dismiss}>Dismiss</button>
        </span>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="What’s new in TripNest">
        <WhatsNewList entries={entries} />
        <button className="btn btn-primary" onClick={dismiss} data-autofocus>Done</button>
      </Dialog>
    </>
  );
}
