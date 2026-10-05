import { useCallback, useEffect, useRef, useState } from 'react';
import { friendly } from '../api/api';

/**
 * Form state that survives failed submits, accidental navigation and refreshes (sessionStorage).
 * Call clear() after a successful save.
 */
export function useDraft<T extends object>(key: string, initial: T): [T, (patch: Partial<T>) => void, () => void] {
  const k = `tripnest:draft:${key}`;
  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(k);
      if (raw) return { ...initial, ...(JSON.parse(raw) as T) };
    } catch { /* ignore */ }
    return initial;
  });
  const set = useCallback((patch: Partial<T>) => setState((s) => ({ ...s, ...patch })), []);
  useEffect(() => {
    try { sessionStorage.setItem(k, JSON.stringify(state)); } catch { /* ignore */ }
  }, [k, state]);
  const clear = useCallback(() => {
    try { sessionStorage.removeItem(k); } catch { /* ignore */ }
    setState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return [state, set, clear];
}

/** Wraps an async action with busy/error state and a friendly message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode runs effect -> cleanup -> effect, so re-arm on every mount
    return () => { alive.current = false; };
  }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (alive.current) setError(friendly(e).message);
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const u = () => setOn(true);
    const d = () => setOn(false);
    window.addEventListener('online', u);
    window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}
