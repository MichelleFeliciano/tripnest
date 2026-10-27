import { useEffect, useRef, useState, type FormEvent } from 'react';
import { eraseEverything } from '../api/backup';
import { getLock, removeLock, unlock, waitSeconds } from '../api/lock';
import { Dialog, ErrorBanner, Field } from './ui';

/** Shown instead of the app while it is locked. Nothing from the trips is drawn behind it. */
export default function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const kind = getLock()?.kind ?? 'pin';
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(waitSeconds());
  const [forgot, setForgot] = useState(false);
  const [confirm, setConfirm] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(waitSeconds()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !secret) return;
    setBusy(true);
    setError(null);
    const r = await unlock(secret);
    setBusy(false);
    if (r === 'ok') return onUnlocked();
    setSecret('');
    setWait(waitSeconds());
    setError(r === 'wait' ? null : `That ${kind === 'pin' ? 'PIN' : 'password'} isn’t right. Try again.`);
    input.current?.focus();
  };

  const erase = async () => {
    try { await eraseEverything(); removeLock(); window.location.assign(import.meta.env.BASE_URL); } catch (e) { setError((e as Error).message); }
  };

  return (
    <main className="lock-screen">
      <form className="card lock-card" onSubmit={submit}>
        <h1><span aria-hidden="true">🔒 </span>TripNest is locked</h1>
        <ErrorBanner message={error} />
        {wait > 0 && <div className="status-banner status-warn" role="alert">Too many wrong tries. Wait {wait} {wait === 1 ? 'second' : 'seconds'} and try again.</div>}
        <Field label={kind === 'pin' ? 'Enter your PIN' : 'Enter your password'}>
          {(id) => <input id={id} ref={input} type="password" inputMode={kind === 'pin' ? 'numeric' : 'text'} autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} disabled={wait > 0} />}
        </Field>
        <button className="btn btn-primary" disabled={busy || wait > 0 || !secret}>Unlock</button>
        <p><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setConfirm(''); setForgot(true); }}>Forgot it?</button></p>
      </form>
      <Dialog open={forgot} onClose={() => setForgot(false)} title="Forgot your PIN or password?">
        <p>There’s no way to reset it, because nothing about it is stored anywhere except on this device. The only way back in is to <strong>erase everything on this device</strong> and then restore from a backup file.</p>
        <Field label="Type ERASE to confirm">{(id) => <input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}</Field>
        <div className="row">
          <button className="btn btn-danger" disabled={confirm.trim() !== 'ERASE'} onClick={erase}>Erase and start over</button>
          <button className="btn" onClick={() => setForgot(false)}>Cancel</button>
        </div>
      </Dialog>
    </main>
  );
}
