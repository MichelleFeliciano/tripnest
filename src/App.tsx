import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { trash, trips } from './api/api';
import { requestPersistence } from './api/db';
import { Alert, Spinner } from './components/ui';
import TripsPage from './pages/TripsPage';
import NewTripPage from './pages/NewTripPage';
import ProfilePage from './pages/ProfilePage';
import TripLayout from './pages/TripLayout';

const Overview = lazy(() => import('./pages/trip/Overview'));
const Itinerary = lazy(() => import('./pages/trip/Itinerary'));
const Reservations = lazy(() => import('./pages/trip/Reservations'));
const Details = lazy(() => import('./pages/trip/Details'));
const Packing = lazy(() => import('./pages/trip/Packing'));
const Expenses = lazy(() => import('./pages/trip/Expenses'));
const Budget = lazy(() => import('./pages/trip/Budget'));
const Todo = lazy(() => import('./pages/trip/Todo'));
const Notes = lazy(() => import('./pages/trip/Notes'));
const Documents = lazy(() => import('./pages/trip/Documents'));
const Travelers = lazy(() => import('./pages/trip/Travelers'));
const Explore = lazy(() => import('./pages/trip/Explore'));
const MapPage = lazy(() => import('./pages/trip/MapPage'));
const SearchPage = lazy(() => import('./pages/trip/SearchPage'));
const Export = lazy(() => import('./pages/trip/Export'));
const Settings = lazy(() => import('./pages/trip/Settings'));
const More = lazy(() => import('./pages/trip/More'));

/** Where "Back" goes when there is no earlier page in this tab (a link opened directly): up one level. */
export function parentPath(pathname: string): string {
  const m = /^\/trips\/([^/]+)\/[^/]+/.exec(pathname);
  return m && m[1] !== 'new' ? `/trips/${m[1]}` : '/trips';
}

function TopBar() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const atRoot = pathname === '/trips' || pathname === '/trips/' || pathname === '/';
  // React Router keeps the position in this tab's history in history.state.idx; 0 means nothing earlier to go back to.
  const goBack = () => (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 ? nav(-1) : nav(parentPath(pathname), { replace: true }));
  return (
    <header className="topbar">
      {!atRoot && <button className="topbar-btn back-btn" onClick={goBack} aria-label="Back">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        <span aria-hidden="true">Back</span>
      </button>}
      <NavLink to="/trips" className="brand" aria-label="TripNest home"><span aria-hidden="true">🌴</span> TripNest</NavLink>
      <nav className="topnav" aria-label="Primary">
        <NavLink to="/trips" end>Trips</NavLink>
        <NavLink to="/trips/new">Create Trip</NavLink>
        <NavLink to="/profile">Profile</NavLink>
      </nav>
      <NavLink to="/profile" className="topbar-btn profile-btn" aria-label="Profile and backups">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" /></svg>
        <span aria-hidden="true">Profile</span>
      </NavLink>
    </header>
  );
}

/**
 * Tables that scroll sideways must be reachable by keyboard (WCAG 2.1.1). Make a .table-wrap focusable
 * only while it actually overflows, and label it, so wide screens get no pointless extra tab stops.
 */
function useScrollableTablesFocusable() {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        document.querySelectorAll<HTMLElement>('.table-wrap').forEach((el) => {
          if (el.scrollWidth > el.clientWidth + 1) {
            el.tabIndex = 0;
            el.setAttribute('role', 'region');
            el.setAttribute('aria-label', `${el.querySelector('caption')?.textContent?.trim() || 'Table'} (scrolls sideways)`);
          } else {
            el.removeAttribute('tabindex');
            el.removeAttribute('role');
            el.removeAttribute('aria-label');
          }
        });
      });
    };
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => { mo.disconnect(); window.removeEventListener('resize', update); cancelAnimationFrame(frame); };
  }, []);
}

export default function App() {
  useScrollableTablesFocusable();
  const [storageProblem, setStorageProblem] = useState<string | null>(null);

  useEffect(() => {
    void requestPersistence(); // ask the browser not to evict our data (best effort)
    trips.list().catch((e: Error) => setStorageProblem(e.message));
    void trash.purgeOld(); // drop anything deleted more than 30 days ago
  }, []);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar />
      {storageProblem && <div className="container" style={{ paddingBottom: 0 }}><Alert kind="error">{storageProblem}</Alert></div>}
      <div id="main">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Navigate to="/trips" replace />} />
            <Route path="/login" element={<Navigate to="/trips" replace />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/new" element={<NewTripPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/trips/:tripId" element={<TripLayout />}>
              <Route index element={<Overview />} />
              <Route path="itinerary" element={<Itinerary />} />
              <Route path="explore" element={<Explore />} />
              <Route path="reservations" element={<Reservations />} />
              <Route path="details" element={<Details />} />
              <Route path="packing" element={<Packing />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="budget" element={<Budget />} />
              <Route path="todo" element={<Todo />} />
              <Route path="notes" element={<Notes />} />
              <Route path="documents" element={<Documents />} />
              <Route path="members" element={<Travelers />} />
              <Route path="map" element={<MapPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="export" element={<Export />} />
              <Route path="settings" element={<Settings />} />
              <Route path="more" element={<More />} />
            </Route>
            <Route path="*" element={<main className="container"><h1>Page not found</h1><NavLink to="/trips">Back to your trips</NavLink></main>} />
          </Routes>
        </Suspense>
      </div>
    </>
  );
}
