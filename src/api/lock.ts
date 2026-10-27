/**
 * App lock: a PIN or password asked for when TripNest opens (and after it has been in the background a while).
 * Only a salted hash is kept, in this browser. This keeps other people who pick up the phone out of the app;
 * it does not encrypt the stored data (a password-protected backup file does that).
 */
export type LockKind = 'pin' | 'password';
export interface LockConfig {
  kind: LockKind;
  salt: string;
  hash: string;
  iterations: number;
  /** Minutes in the background before locking again. 0 = as soon as the app is left. */
  autoLockMinutes: number;
}
const KEY = 'tripnest:lock';
const TRIES_KEY = 'tripnest:lock-tries';
const ITERATIONS = 150_000;
export const AUTO_LOCK_CHOICES = [0, 1, 5, 15] as const;

const b64 = (b: ArrayBuffer | Uint8Array) => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function derive(secret: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** A problem with a proposed PIN or password, or null if it is fine. */
export function secretProblem(kind: LockKind, secret: string): string | null {
  if (kind === 'pin') return /^\d{4,10}$/.test(secret) ? null : 'A PIN is 4 to 10 digits.';
  return secret.length >= 6 ? null : 'Use at least 6 characters.';
}

export function getLock(): LockConfig | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LockConfig> | null;
    if (!s || (s.kind !== 'pin' && s.kind !== 'password') || typeof s.salt !== 'string' || typeof s.hash !== 'string') return null;
    return { kind: s.kind, salt: s.salt, hash: s.hash, iterations: Number.isInteger(s.iterations) ? (s.iterations as number) : ITERATIONS, autoLockMinutes: AUTO_LOCK_CHOICES.includes(s.autoLockMinutes as 0) ? (s.autoLockMinutes as number) : 1 };
  } catch { return null; }
}
export const isLockOn = () => getLock() !== null;

export async function setLock(kind: LockKind, secret: string, autoLockMinutes = 1): Promise<void> {
  const problem = secretProblem(kind, secret);
  if (problem) throw new Error(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cfg: LockConfig = { kind, salt: b64(salt), hash: await derive(secret, salt, ITERATIONS), iterations: ITERATIONS, autoLockMinutes };
  localStorage.setItem(KEY, JSON.stringify(cfg));
  resetTries();
}
export function setAutoLock(minutes: number): void {
  const c = getLock();
  if (c) localStorage.setItem(KEY, JSON.stringify({ ...c, autoLockMinutes: minutes }));
}
export function removeLock(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(TRIES_KEY); } catch { /* ignore */ }
}

// ── slowing down guesses ──
interface Tries { fails: number; until: number }
const tries = (): Tries => { try { return { fails: 0, until: 0, ...(JSON.parse(localStorage.getItem(TRIES_KEY) ?? '{}') as Partial<Tries>) }; } catch { return { fails: 0, until: 0 }; } };
const resetTries = () => { try { localStorage.removeItem(TRIES_KEY); } catch { /* ignore */ } };
/** After 5 wrong tries in a row, wait 30 seconds, then a minute, then double each time (up to an hour). */
export function waitSeconds(now = Date.now()): number { return Math.max(0, Math.ceil((tries().until - now) / 1000)); }
export function lockDelayMs(fails: number): number { return fails < 5 ? 0 : Math.min(3_600_000, 30_000 * 2 ** (fails - 5)); }

export async function unlock(secret: string, now = Date.now()): Promise<'ok' | 'wrong' | 'wait'> {
  const c = getLock();
  if (!c) return 'ok';
  if (waitSeconds(now) > 0) return 'wait';
  const ok = (await derive(secret, unb64(c.salt), c.iterations)) === c.hash;
  if (ok) { resetTries(); return 'ok'; }
  const fails = tries().fails + 1;
  try { localStorage.setItem(TRIES_KEY, JSON.stringify({ fails, until: now + lockDelayMs(fails) })); } catch { /* ignore */ }
  return waitSeconds(now) > 0 ? 'wait' : 'wrong';
}

/** Whether to lock again after the app was in the background from `hiddenAt` until `now`. */
export function shouldRelock(hiddenAt: number, now: number, minutes: number): boolean {
  return now - hiddenAt >= minutes * 60_000;
}
