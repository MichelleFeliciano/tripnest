import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { friendly, loadTrip } from '../api/api';
import type { TripData } from '../api/types';

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

  const reload = useCallback(async () => {
    if (!tripId) return;
    try {
      setData(await loadTrip(tripId));
      setError(null);
    } catch (e) {
      setError(friendly(e).message);
    } finally {
      setLoading(false);
    }
  }, [tripId]);
  useEffect(() => { setLoading(true); setData(null); void reload(); }, [reload]);

  const ctx = useMemo<TripCtx | null>(() => (data ? { data, me: data.me, reload } : null), [data, reload]);
  return { ctx, error, loading, reload };
}
