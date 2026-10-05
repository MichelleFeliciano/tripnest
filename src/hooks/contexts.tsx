import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { loadTrip, profiles } from '../api/api';
import type { Profile, TripData } from '../api/types';
import { can, type Action } from '../lib/permissions';

// ───────── auth ─────────
interface AuthCtx {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}
const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const refreshProfile = useCallback(async () => {
    if (!userId) return setProfile(null);
    try { setProfile(await profiles.get(userId)); } catch { /* profile is non-critical */ }
  }, [userId]);
  useEffect(() => { void refreshProfile(); }, [refreshProfile]);

  const value = useMemo(() => ({ session, user: session?.user ?? null, profile, loading, refreshProfile }), [session, profile, loading, refreshProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

// ───────── trip ─────────
interface TripCtx {
  data: TripData;
  me: string;
  reload: () => Promise<void>;
  can: (a: Action) => boolean;
}
const TripContext = createContext<TripCtx | null>(null);
export const TripProvider = TripContext.Provider;
export function useTrip(): TripCtx {
  const c = useContext(TripContext);
  if (!c) throw new Error('useTrip outside TripProvider');
  return c;
}

export function useTripLoader(tripId: string | undefined, userId: string | undefined) {
  const [data, setData] = useState<TripData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!tripId || !userId) return;
    try {
      setData(await loadTrip(tripId, userId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tripId, userId]);
  useEffect(() => { setLoading(true); setData(null); void reload(); }, [reload]);

  const ctx = useMemo<TripCtx | null>(
    () => (data && userId ? { data, me: userId, reload, can: (a) => can(data.role, a) } : null),
    [data, userId, reload],
  );
  return { ctx, error, loading, reload };
}
