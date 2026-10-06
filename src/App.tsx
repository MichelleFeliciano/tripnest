import { lazy, Suspense, useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/contexts';
import { isConfigured } from './api/supabase';
import { auth } from './api/api';
import { Alert, Spinner } from './components/ui';
import { useOnline } from './hooks/hooks';
import { LoginPage, ResetPasswordPage } from './pages/AuthPages';
import TripsPage from './pages/TripsPage';
import NewTripPage from './pages/NewTripPage';
import ProfilePage from './pages/ProfilePage';
import InvitePage from './pages/InvitePage';
import TripLayout from './pages/TripLayout';

const Overview = lazy(() => import('./pages/trip/Overview'));
const Itinerary = lazy(() => import('./pages/trip/Itinerary'));
const Reservations = lazy(() => import('./pages/trip/Reservations'));
const Details = lazy(() => import('./pages/trip/Details'));
const Packing = lazy(() => import('./pages/trip/Packing'));
const Expenses = lazy(() => import('./pages/trip/Expenses'));
const Budget = lazy(() => import('./pages/trip/Budget'));
const Notes = lazy(() => import('./pages/trip/Notes'));
const Documents = lazy(() => import('./pages/trip/Documents'));
const Members = lazy(() => import('./pages/trip/Members'));
const Explore = lazy(() => import('./pages/trip/Explore'));
const MapPage = lazy(() => import('./pages/trip/MapPage'));
const SearchPage = lazy(() => import('./pages/trip/SearchPage'));
const Export = lazy(() => import('./pages/trip/Export'));
const Settings = lazy(() => import('./pages/trip/Settings'));
const Assistant = lazy(() => import('./pages/trip/Assistant'));
const More = lazy(() => import('./pages/trip/More'));

function SetupScreen() {
  return (
    <main className="container">
      <h1>TripNest setup needed</h1>
      <Alert kind="warn">
        This app needs a Supabase project. Copy <code>.env.example</code> to <code>.env</code>, fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        See README.md for the 5-minute database setup.
      </Alert>
    </main>
  );
}

function TopBar() {
  const { user } = useAuth();
  return (
    <header className="topbar">
      <NavLink to="/trips" className="brand" aria-label="TripNest home">🧭 TripNest</NavLink>
      {user && (
        <nav className="topnav" aria-label="Primary">
          <NavLink to="/trips" end>Trips</NavLink>
          <NavLink to="/trips/new">Create Trip</NavLink>
          <NavLink to="/profile">Profile</NavLink>
          <button className="btn btn-ghost btn-sm" onClick={() => auth.signOut()}>Log out</button>
        </nav>
      )}
      {user && (
        <button className="btn btn-ghost btn-sm only-mobile" onClick={() => auth.signOut()}>Log out</button>
      )}
    </header>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
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
  const online = useOnline();
  if (!isConfigured) return <SetupScreen />;
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <TopBar />
      {!online && <div className="container" style={{ paddingBottom: 0 }}><Alert kind="warn">You're offline. Showing saved trip data where available. Changes can't be saved until you reconnect.</Alert></div>}
      <div id="main">
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<Navigate to="/trips" replace />} />
            <Route path="/trips" element={<RequireAuth><TripsPage /></RequireAuth>} />
            <Route path="/trips/new" element={<RequireAuth><NewTripPage /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="/invite/:token" element={<RequireAuth><InvitePage /></RequireAuth>} />
            <Route path="/trips/:tripId" element={<RequireAuth><TripLayout /></RequireAuth>}>
              <Route index element={<Overview />} />
              <Route path="itinerary" element={<Itinerary />} />
              <Route path="reservations" element={<Reservations />} />
              <Route path="details" element={<Details />} />
              <Route path="packing" element={<Packing />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="budget" element={<Budget />} />
              <Route path="notes" element={<Notes />} />
              <Route path="documents" element={<Documents />} />
              <Route path="members" element={<Members />} />
              <Route path="explore" element={<Explore />} />
              <Route path="map" element={<MapPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="export" element={<Export />} />
              <Route path="settings" element={<Settings />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="more" element={<More />} />
            </Route>
            <Route path="*" element={<main className="container"><h1>Page not found</h1><NavLink to="/trips">Back to your trips</NavLink></main>} />
          </Routes>
        </Suspense>
      </div>
    </>
  );
}
