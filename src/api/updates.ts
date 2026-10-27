/**
 * Keeps the app up to date. A new version is downloaded in the background and then WAITS: a banner offers
 * "Update now", which activates it and reloads. Nothing changes under the person's feet while they are typing.
 */
import { useSyncExternalStore } from 'react';

interface State { available: boolean; checking: boolean }
let state: State = { available: false, checking: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useUpdateState = () => useSyncExternalStore(subscribe, () => state);

let registration: ServiceWorkerRegistration | undefined;
let reloadOnChange = false;

function watch(reg: ServiceWorkerRegistration) {
  const check = () => { if (reg.waiting && navigator.serviceWorker.controller) set({ available: true }); };
  check();
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
  });
}

export function registerUpdates(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      registration = reg;
      watch(reg);
      // look for a new version when the app comes back to the front, and now and then while it stays open
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate(); });
      setInterval(() => { void checkForUpdate(); }, 60 * 60 * 1000);
    }).catch(() => undefined);
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadOnChange) window.location.reload(); });
}

/** 'available' (a new version is ready), 'current', 'offline', or 'unsupported' (no offline support in this browser/mode). */
export async function checkForUpdate(): Promise<'available' | 'current' | 'offline' | 'unsupported'> {
  if (!registration) return 'unsupported';
  if (state.available) return 'available';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  set({ checking: true });
  try {
    await registration.update();
    if (registration.waiting && navigator.serviceWorker.controller) { set({ available: true }); return 'available'; }
    // the new worker may still be installing: give it a moment
    const inst = registration.installing;
    if (inst) await new Promise<void>((res) => { inst.addEventListener('statechange', () => { if (inst.state === 'installed' || inst.state === 'redundant') res(); }); setTimeout(res, 15_000); });
    if (registration.waiting && navigator.serviceWorker.controller) { set({ available: true }); return 'available'; }
    return 'current';
  } catch { return 'offline'; }
  finally { set({ checking: false }); }
}

/** Switch to the waiting version and reload. */
export function updateNow(): void {
  const w = registration?.waiting;
  if (!w) { window.location.reload(); return; }
  reloadOnChange = true;
  w.postMessage('SKIP_WAITING');
  setTimeout(() => window.location.reload(), 3000); // safety net if the switch event never arrives
}

/** The name of the cache this version is using, e.g. "tripnest-v1.1.0-ab12cd34ef56", or null when not installed yet. */
export async function cacheName(): Promise<string | null> {
  try { return (await caches.keys()).filter((k) => k.startsWith('tripnest-v')).sort().pop() ?? null; } catch { return null; }
}
