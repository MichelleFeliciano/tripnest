import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useTripLoader, TripProvider } from '../hooks/contexts';
import { Alert, Spinner, StatusBadge } from '../components/ui';
import { formatDateRange, tripDuration } from '../lib/trip';
import { countdown } from '../lib/countdown';
import { browserTimeZone, localDate } from '../lib/time';

const TABS: [string, string][] = [
  ['', 'Overview'], ['itinerary', 'Itinerary'], ['explore', 'Explore'], ['reservations', 'Reservations'], ['details', 'Travel details'], ['packing', 'Packing'], ['todo', 'To-do'],
  ['expenses', 'Expenses'], ['budget', 'Budget'], ['notes', 'Notes'], ['documents', 'Documents'], ['members', 'Travelers'],
  ['map', 'Map'], ['search', 'Search'], ['export', 'Export'], ['settings', 'Settings'],
];

export default function TripLayout() {
  const { tripId } = useParams();
  const { ctx, error, loading, reload } = useTripLoader(tripId);

  if (loading) return <Spinner label="Opening trip…" />;
  if (error || !ctx) {
    return (
      <main className="container">
        <Alert>{error ?? 'That trip was not found on this device.'}</Alert>
        <button className="btn" onClick={() => void reload()}>Try again</button> <NavLink to="/trips">Back to trips</NavLink>
      </main>
    );
  }
  const { trip } = ctx.data;
  const { days, nights } = tripDuration(trip.start_date, trip.end_date);
  const base = `/trips/${trip.id}`;
  const when = countdown(trip.start_date, trip.end_date, localDate(new Date(), browserTimeZone()));

  return (
    <TripProvider value={ctx}>
      <main className="container">
        <div className="trip-head hero">
          <div style={{ flex: 1, minWidth: 220 }}>
            <h1 style={{ marginBottom: 2 }}>{trip.name}</h1>
            <p className="muted" style={{ margin: 0 }}>{formatDateRange(trip.start_date, trip.end_date)} · {days} {days === 1 ? 'day' : 'days'} · {nights} {nights === 1 ? 'night' : 'nights'}</p>
          </div>
          <div className="trip-status"><StatusBadge status={trip.status} /> <strong className="countdown">{when.text}</strong></div>
        </div>
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
