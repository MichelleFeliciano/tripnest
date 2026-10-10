import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly, trips as tripsApi } from '../api/api';
import { importTrips, parseBackup } from '../api/backup';
import type { Trip } from '../api/types';
import { Alert, Empty, ErrorBanner, Spinner, StatusBadge } from '../components/ui';
import { useAction } from '../hooks/hooks';
import { DATA_CHANGED } from '../components/Toast';
import BackupNudges from '../components/BackupNudges';
import { formatDateRange, tripDuration } from '../lib/trip';

export default function TripsPage() {
  const [list, setList] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imp = useAction();

  const refresh = () => tripsApi.list().then(setList).catch((e) => setError(friendly(e).message));
  useEffect(() => {
    void refresh();
    window.addEventListener(DATA_CHANGED, refresh);
    return () => window.removeEventListener(DATA_CHANGED, refresh);
  }, []);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setNotice(null);
    const ids = await imp.run(async () => importTrips(parseBackup(await f.text())));
    if (fileRef.current) fileRef.current.value = '';
    if (ids) { setNotice(`Added ${ids.length} ${ids.length === 1 ? 'trip' : 'trips'} from the file.`); await refresh(); }
  };

  if (error) return <main className="container"><Alert>{error}</Alert></main>;
  if (!list) return <Spinner />;
  const active = list.filter((t) => t.status !== 'archived');
  const archived = list.filter((t) => t.status === 'archived');
  const shown = showArchived ? list : active;

  return (
    <main className="container">
      <div className="hero">
        <h1>Your trips</h1>
        <p>Plan it all in one place. Everything stays on this device.</p>
      </div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row">
          <Link className="btn btn-primary" to="/trips/new">+ New trip</Link>
          <label className="btn">
            Import a trip file
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      <BackupNudges trips={list} />
      <ErrorBanner message={imp.error} />
      {shown.length === 0 ? (
        <Empty title="No trips yet">Create your first trip, or import a trip file someone sent you.</Empty>
      ) : (
        <ul className="list grid grid-2" style={{ gap: 16 }}>
          {shown.map((t) => {
            const { days, nights } = tripDuration(t.start_date, t.end_date);
            return (
              <li key={t.id} className="card trip-card" style={{ margin: 0 }}>
                {t.cover_image_url && /^https:\/\//.test(t.cover_image_url) && <img className="cover" src={t.cover_image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div className="row-between">
                  <h2 style={{ margin: 0 }}><Link to={`/trips/${t.id}`}>{t.name}</Link></h2>
                  <StatusBadge status={t.status} />
                </div>
                <p className="muted">{formatDateRange(t.start_date, t.end_date)} · {days} {days === 1 ? 'day' : 'days'} · {nights} {nights === 1 ? 'night' : 'nights'}</p>
                {t.primary_destination && <p><span aria-hidden="true">📍 </span>{t.primary_destination}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <button className="btn btn-ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>
      )}
      <p className="muted" style={{ marginTop: 24 }}>Tip: use <Link to="/profile">Profile → Back up</Link> now and then. Trips are stored only in this browser.</p>
    </main>
  );
}
