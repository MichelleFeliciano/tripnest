/**
 * Password protection for backup files, using the browser's built-in Web Crypto (no extra code or libraries):
 *  - the key is derived from the password with PBKDF2 (SHA-256, 600,000 rounds) and a random salt
 *  - the file is encrypted with AES-256-GCM, which also detects a wrong password or any tampering
 * The password is never stored or sent anywhere. A forgotten password cannot be recovered.
 */
import { ApiError } from './api';

export const PBKDF2_ROUNDS = 600_000;
const MIN_ROUNDS = 1_000; // low only so tests run fast; a file can always choose to be weaker, but only for itself
const MAX_ROUNDS = 10_000_000; // stop a crafted file from freezing the page
export const MIN_PASSWORD_LENGTH = 8;

export interface EncryptedBackup {
  app: 'tripnest';
  format: number;
  encrypted: true;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new ApiError('Password protection needs a secure connection (https). Open TripNest from its normal web address and try again.');
  return s;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

/** Cheap check on the start of the text, so a large plain backup is not parsed twice. */
export function isEncryptedBackup(text: string): boolean {
  return /^\s*\{\s*"app"\s*:\s*"tripnest"\s*,\s*"format"\s*:\s*\d+\s*,\s*"encrypted"\s*:\s*true/.test(text.slice(0, 200));
}

export async function encryptBackup(plain: string, password: string, rounds = PBKDF2_ROUNDS): Promise<string> {
  const problem = passwordProblem(password);
  if (problem) throw new ApiError(problem);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, rounds);
  const cipher = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const envelope: EncryptedBackup = { app: 'tripnest', format: 1, encrypted: true, kdf: 'PBKDF2-SHA256', iterations: rounds, salt: b64(salt), iv: b64(iv), data: b64(cipher) };
  return JSON.stringify(envelope);
}

export class WrongPasswordError extends ApiError {}

/** Throws WrongPasswordError for a wrong password or a damaged file (they cannot be told apart, by design). */
export async function decryptBackup(text: string, password: string): Promise<string> {
  let env: Partial<EncryptedBackup>;
  try { env = JSON.parse(text) as Partial<EncryptedBackup>; } catch { throw new ApiError("That file isn't a TripNest backup (it couldn't be read)."); }
  if (env.app !== 'tripnest' || env.encrypted !== true || env.kdf !== 'PBKDF2-SHA256' || typeof env.salt !== 'string' || typeof env.iv !== 'string' || typeof env.data !== 'string'
    || !Number.isInteger(env.iterations) || env.iterations! < MIN_ROUNDS || env.iterations! > MAX_ROUNDS) {
    throw new ApiError("That file isn't a TripNest backup, or it was made by a newer version of the app.");
  }
  try {
    const salt = unb64(env.salt);
    const iv = unb64(env.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('bad sizes');
    const key = await deriveKey(password, salt, env.iterations!);
    return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv }, key, unb64(env.data)));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new WrongPasswordError('That password did not open the file. Check it and try again. (If you are sure it is right, the file may be damaged.)');
  }
}
