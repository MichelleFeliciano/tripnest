import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useAuth, TripProvider, useTripLoader } from '../hooks/contexts';
import { Alert, Spinner, StatusBadge } from '../components/ui';
import { formatDateRange, tripDuration } from '../lib/trip';

const TABS: [string, string][] = [
  ['', 'Overview'], ['itinerary', 'Itinerary'], ['reservations', 'Reservations'], ['details', 'Travel details'], ['packing', 'Packing'],
  ['expenses', 'Expenses'], ['budget', 'Budget'], ['notes', 'Notes'], ['documents', 'Documents'], ['members', 'Members'],
  ['map', 'Map'], ['search', 'Search'], ['export', 'Export'], ['settings', 'Settings'],
];

export default function TripLayout() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const { ctx, error, loading, reload } = useTripLoader(tripId, user?.id);

  if (loading) return <Spinner label="Loading trip…" />;
  if (error || !ctx) {
    return (
      <main className="container">
        <Alert>{error ?? 'Trip not found, or you do not have access to it.'}</Alert>
        <button className="btn" onClick={() => void reload()}>Try again</button> <NavLink to="/trips">Back to trips</NavLink>
      </main>
    );
  }
  const { trip } = ctx.data;
  const { days, nights } = tripDuration(trip.start_date, trip.end_date);
  const base = `/trips/${trip.id}`;
  const stale = ctx.data.fromCache;

  return (
    <TripProvider value={ctx}>
      <main className="container">
        <div className="trip-head">
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ marginBottom: 2 }}>{trip.name}</h1>
            <p className="muted" style={{ margin: 0 }}>{formatDateRange(trip.start_date, trip.end_date)} · {days} {days === 1 ? 'day' : 'days'} · {nights} {nights === 1 ? 'night' : 'nights'}</p>
          </div>
          <StatusBadge status={trip.status} />
        </div>
        {stale && <Alert kind="warn">You're viewing a saved copy from {new Date(ctx.data.loadedAt).toLocaleString()}. <button className="btn btn-sm" onClick={() => void reload()}>Refresh</button></Alert>}
        {ctx.data.role === 'viewer' && <Alert kind="info">You have view-only access to this trip.</Alert>}
        <nav className="tabs" aria-label="Trip sections">
          {TABS.map(([path, label]) => (
            <NavLink key={path} to={path ? `${base}/${path}` : base} end>{label}</NavLink>
          ))}
        </nav>
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Trip sections">
        <NavLink to={base} end><span className="ico" aria-hidden="true">🏠</span>Today</NavLink>
        <NavLink to={`${base}/itinerary`}><span className="ico" aria-hidden="true">📅</span>Itinerary</NavLink>
        <NavLink to={`${base}/packing`}><span className="ico" aria-hidden="true">🎒</span>Packing</NavLink>
        <NavLink to={`${base}/expenses`}><span className="ico" aria-hidden="true">💵</span>Expenses</NavLink>
        <NavLink to={`${base}/more`}><span className="ico" aria-hidden="true">⋯</span>More</NavLink>
      </nav>
    </TripProvider>
  );
}
