import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { friendly, trash, type Deleted } from '../api/api';

/** Tell every open screen that stored data changed (after an undo, so lists reload themselves). */
export const DATA_CHANGED = 'tripnest:data-changed';
export const announceDataChanged = () => window.dispatchEvent(new Event(DATA_CHANGED));

interface ToastApi {
  /** Show "Deleted … Undo" for something just deleted. Pass the value the delete function returned. */
  deleted: (d: Deleted | undefined) => void;
  /** Show a plain message. */
  say: (text: string) => void;
}
const Ctx = createContext<ToastApi>({ deleted: () => undefined, say: () => undefined });
export const useToast = () => useContext(Ctx);

interface Shown { key: number; text: string; undoId?: string; error?: boolean }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  const show = useCallback((s: Omit<Shown, 'key'>, ms = 10_000) => {
    clearTimeout(timer.current);
    setShown({ ...s, key: ++seq.current });
    timer.current = setTimeout(() => setShown(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const api = useMemo<ToastApi>(() => ({
    deleted: (d) => { if (d) show({ text: `Deleted ${d.summary}.`, undoId: d.id }); },
    say: (text) => show({ text }, 5000),
  }), [show]);

  const undo = async () => {
    if (!shown?.undoId) return;
    try {
      const r = await trash.restore(shown.undoId);
      announceDataChanged();
      show({ text: `Restored ${r.summary}.` }, 5000);
    } catch (e) {
      show({ text: friendly(e).message, error: true }, 8000);
    }
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {shown && (
          <div key={shown.key} className={`toast ${shown.error ? 'toast-error' : ''}`}>
            <span>{shown.text}</span>
            {shown.undoId && <button className="btn btn-sm toast-btn" onClick={undo}>Undo</button>}
            <button className="btn btn-sm btn-ghost toast-btn" onClick={() => setShown(null)} aria-label="Dismiss message">✕</button>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
