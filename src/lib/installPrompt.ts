/**
 * Android Chrome (and desktop Chrome/Edge) offer to install a web app by firing `beforeinstallprompt`; the page may
 * keep that event and show its own button. The event can fire before any screen exists, so it is captured at startup.
 */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // stop the browser's own mini-bar; we show a button instead
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferred = null; notify(); });
}

export const canInstall = (): boolean => deferred !== null;
export const onInstallChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Shows the browser's install dialog. Returns whether the person accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null; // an install event can only be used once
  notify();
  try {
    await e.prompt();
    return (await e.userChoice).outcome === 'accepted';
  } catch { return false; }
}
