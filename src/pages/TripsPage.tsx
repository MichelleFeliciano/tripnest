import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { trips as tripsApi } from '../api/api';
import type { Trip } from '../api/types';
import { Alert, Empty, Spinner, StatusBadge } from '../components/ui';
import { formatDateRange, tripDuration } from '../lib/trip';

export default function TripsPage() {
  const [list, setList] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    tripsApi.list().then(setList).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <main className="container"><Alert>{error}</Alert></main>;
  if (!list) return <Spinner />;
  const active = list.filter((t) => t.status !== 'archived');
  const archived = list.filter((t) => t.status === 'archived');
  const shown = showArchived ? list : active;

  return (
    <main className="container">
      <div className="row-between">
        <h1>Your trips</h1>
        <Link className="btn btn-primary" to="/trips/new">+ New trip</Link>
      </div>
      {shown.length === 0 ? (
        <Empty title="No trips yet">Create your first trip, or open an invitation link someone sent you.</Empty>
      ) : (
        <ul className="list grid grid-2" style={{ gap: 16 }}>
          {shown.map((t) => {
            const { days, nights } = tripDuration(t.start_date, t.end_date);
            return (
              <li key={t.id} className="card" style={{ margin: 0 }}>
                {t.cover_image_url && /^https:\/\//.test(t.cover_image_url) && <img className="cover" src={t.cover_image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                <div className="row-between">
                  <h2 style={{ margin: 0 }}><Link to={`/trips/${t.id}`}>{t.name}</Link></h2>
                  <StatusBadge status={t.status} />
                </div>
                <p className="muted">{formatDateRange(t.start_date, t.end_date)} · {days} {days === 1 ? 'day' : 'days'} · {nights} {nights === 1 ? 'night' : 'nights'}</p>
                {t.primary_destination && <p>📍 {t.primary_destination}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <button className="btn btn-ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide' : 'Show'} archived ({archived.length})</button>
      )}
    </main>
  );
}
