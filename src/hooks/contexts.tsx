import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { friendly, loadTrip } from '../api/api';
import type { TripData } from '../api/types';
import { DATA_CHANGED } from '../components/Toast';

interface TripCtx {
  data: TripData;
  /** Traveler id of "me" on this device. */
  me: string;
  reload: () => Promise<void>;
}
const TripContext = createContext<TripCtx | null>(null);
export const TripProvider = TripContext.Provider;
export function useTrip(): TripCtx {
  const c = useContext(TripContext);
  if (!c) throw new Error('useTrip outside TripProvider');
  return c;
}

export function useTripLoader(tripId: string | undefined) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const latest = useRef(tripId);
  latest.current = tripId;
  const reload = useCallback(async () => {
    if (!tripId) return;
    try {
      const loaded = await loadTrip(tripId);
      if (latest.current !== tripId) return; // the person has moved to another trip since: do not show this one
      setData(loaded);
      setError(null);
    } catch (e) {
      if (latest.current === tripId) setError(friendly(e).message);
    } finally {
      if (latest.current === tripId) setLoading(false);
    }
  }, [tripId]);
  useEffect(() => { setLoading(true); setData(null); void reload(); }, [reload]);
  // an Undo (or another tab's restore) changes stored data: reload what is on screen
  useEffect(() => {
    const again = () => { void reload(); };
    window.addEventListener(DATA_CHANGED, again);
    return () => window.removeEventListener(DATA_CHANGED, again);
  }, [reload]);

  const ctx = useMemo<TripCtx | null>(() => (data ? { data, me: data.me, reload } : null), [data, reload]);
  return { ctx, error, loading, reload };
}
