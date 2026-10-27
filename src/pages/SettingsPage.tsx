import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getDevice } from '../api/device';
import { storageEstimate } from '../api/db';
import { AUTO_LOCK_CHOICES, getLock, removeLock, secretProblem, setAutoLock, setLock, type LockKind } from '../api/lock';
import { getPrefs, setPrefs, TEXT_SIZES, type Prefs } from '../api/prefs';
import { cacheName, checkForUpdate, updateNow, useUpdateState } from '../api/updates';
import { WhatsNewList } from '../components/WhatsNew';
import { Alert, ErrorBanner, Field } from '../components/ui';
import { LOCK_NOW_EVENT } from '../lib/events';
import { APP_VERSION, BUILD_DATE, CHANGELOG } from '../lib/changelog';
import { percentUsed, storageLevel } from '../lib/storage';
import { formatDateShort } from '../lib/time';
import { useOnline } from '../hooks/hooks';

type Level = 'ok' | 'warn' | 'info';
interface Check { name: string; level: Level; text: ReactNode }
const MARK: Record<Level, [string, string]> = { ok: ['✓', 'OK'], warn: ['!', 'Needs attention'], info: ['i', 'Note'] };

const THEMES: [Prefs['theme'], string][] = [['auto', 'Automatic (follow my device)'], ['light', 'Light'], ['dark', 'Dark']];
const LOCK_WAIT = (m: number) => (m === 0 ? 'As soon as I leave the app' : m === 1 ? 'After 1 minute away' : `After ${m} minutes away`);
const DAY = 86_400_000;

export default function SettingsPage() {
  const [prefs, setP] = useState(getPrefs());
  const update = useUpdateState();
  const online = useOnline();
  const [cache, setCache] = useState<string | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [lock, setLockState] = useState(getLock());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { void cacheName().then(setCache); void storageEstimate().then(setUsage); }, []);

  const checkNow = async () => {
    setChecked(null);
    const r = await checkForUpdate();
    setChecked({ available: 'A new version is ready. Use “Update now”.', current: 'You have the latest version.', offline: 'Couldn’t check: you appear to be offline.', unsupported: 'Updates are checked automatically in the installed app. This browser or mode isn’t using offline support.' }[r]);
  };

  // ── the settings check ──
  const device = getDevice();
  const backupAge = device.last_backup_at ? Date.now() - Date.parse(device.last_backup_at) : null;
  const level = usage ? storageLevel(usage.usedBytes, usage.quotaBytes) : 'unknown';
  const offlineReady = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  const checks: Check[] = [
    backupAge === null
      ? { name: 'Backup', level: 'warn', text: <>You haven’t made a backup on this device yet. <Link to="/profile">Back up now</Link>.</> }
      : { name: 'Backup', level: backupAge > 30 * DAY ? 'warn' : 'ok', text: <>Last backup {formatDateShort(device.last_backup_at!.slice(0, 10))}{backupAge > 30 * DAY && <>. It’s been a while: <Link to="/profile">back up now</Link></>}.</> },
    { name: 'App lock', level: lock ? 'ok' : 'info', text: lock ? `On (${lock.kind === 'pin' ? 'PIN' : 'password'}).` : 'Off. Anyone who opens this phone can open TripNest.' },
    { name: 'Offline', level: offlineReady ? 'ok' : 'info', text: offlineReady ? (online ? 'Ready: TripNest opens without a connection.' : 'You are offline right now, and TripNest is working.') : 'Not set up yet. Open TripNest once while online and it will be saved on this device.' },
    { name: 'Sync', level: 'info', text: <>Not used. Trips live only on this device. To share or move one, send a trip file (see <Link to="/help">Help</Link>).</> },
    { name: 'Storage', level: level === 'low' || level === 'full' ? 'warn' : 'ok', text: usage ? `${percentUsed(usage.usedBytes, usage.quotaBytes)}% of the allowance is used. ${usage.persistent ? 'The browser has promised to keep your data.' : 'The browser may clear your data if the device runs low on space, so keep a backup.'}` : 'Could not be measured in this browser.' },
    { name: 'Updates', level: update.available ? 'warn' : 'ok', text: update.available ? 'A new version is ready to install.' : `You’re on version ${APP_VERSION}.` },
    { name: 'Weather lookups', level: 'info', text: device.weather_on ? 'On: destination coordinates are sent to Open-Meteo when you open a trip.' : 'Off: nothing is sent for weather.' },
  ];

  return (
    <main className="container">
      <h1>Settings</h1>
      <p className="muted"><Link to="/profile">Profile and backups</Link> · <Link to="/history">History</Link> · <Link to="/help">Help</Link></p>

      <section className="card" aria-labelledby="chk-h">
        <h2 id="chk-h">Settings check</h2>
        <ul className="checklist list">
          {checks.map((c) => (
            <li key={c.name}>
              <span className={`chk chk-${c.level}`} aria-hidden="true">{MARK[c.level][0]}</span>
              <div><strong>{c.name}</strong> <span className="sr-only">{MARK[c.level][1]}.</span><div className="muted">{c.text}</div></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="ver-h">
        <h2 id="ver-h">Version and updates</h2>
        <dl className="kv">
          <dt>Version</dt><dd data-testid="app-version">{APP_VERSION}</dd>
          <dt>Last updated</dt><dd>{BUILD_DATE ? formatDateShort(BUILD_DATE) : 'Not known (development build)'}</dd>
          <dt>Saved copy</dt><dd data-testid="cache-name">{cache ?? 'Not saved for offline use yet'}</dd>
        </dl>
        {update.available && <Alert kind="info">A new version is ready. Your trips are not affected.</Alert>}
        {checked && <p role="status">{checked}</p>}
        <div className="row">
          {update.available
            ? <button className="btn btn-primary" onClick={updateNow}>Update now</button>
            : <button className="btn" onClick={checkNow} disabled={update.checking}>{update.checking ? 'Checking…' : 'Check for updates'}</button>}
        </div>
        <h3 style={{ marginTop: 16 }}>What’s new</h3>
        <WhatsNewList entries={CHANGELOG.slice(0, 3)} />
        {CHANGELOG.length > 3 && <details><summary>Earlier versions</summary><WhatsNewList entries={CHANGELOG.slice(3)} /></details>}
      </section>

      <section className="card" aria-labelledby="look-h">
        <h2 id="look-h">Look and feel</h2>
        <fieldset className="plain">
          <legend>Colours</legend>
          {THEMES.map(([id, label]) => (
            <label key={id} className="check"><input type="radio" name="theme" checked={prefs.theme === id} onChange={() => setP(setPrefs({ theme: id }))} /> {label}</label>
          ))}
        </fieldset>
        <fieldset className="plain">
          <legend>Text size</legend>
          {TEXT_SIZES.map((t) => (
            <label key={t.id} className="check"><input type="radio" name="textsize" checked={prefs.textSize === t.id} onChange={() => setP(setPrefs({ textSize: t.id }))} /> {t.label}</label>
          ))}
        </fieldset>
      </section>

      <LockCard lock={lock} onChange={(l, m) => { setLockState(l); setMsg(m); }} msg={msg} />
    </main>
  );
}

function LockCard({ lock, onChange, msg }: { lock: ReturnType<typeof getLock>; onChange: (l: ReturnType<typeof getLock>, msg: string | null) => void; msg: string | null }) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<LockKind>('pin');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [mins, setMins] = useState<number>(lock?.autoLockMinutes ?? 1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = secretProblem(kind, a);
    if (problem) return setError(problem);
    if (a !== b) return setError('The two entries don’t match.');
    setBusy(true);
    try { await setLock(kind, a, mins); setEditing(false); setA(''); setB(''); onChange(getLock(), `App lock is on (${kind === 'pin' ? 'PIN' : 'password'}). Don’t forget it: it can’t be reset.`); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <section className="card" aria-labelledby="lock-h">
      <h2 id="lock-h">App lock</h2>
      {msg && <Alert kind="success">{msg}</Alert>}
      <p>Ask for a PIN or password whenever TripNest is opened. It keeps other people out of your trips if they pick up your phone. It doesn’t scramble the stored data; to protect a file, lock your backup with a password.</p>
      {lock && !editing ? (
        <>
          <Field label="Lock again…">
            {(id) => <select id={id} value={lock.autoLockMinutes} onChange={(e) => { const m = Number(e.target.value); setAutoLock(m); setMins(m); onChange(getLock(), null); }}>{AUTO_LOCK_CHOICES.map((m) => <option key={m} value={m}>{LOCK_WAIT(m)}</option>)}</select>}
          </Field>
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.dispatchEvent(new Event(LOCK_NOW_EVENT))}>Lock now</button>
            <button className="btn" onClick={() => { setEditing(true); setKind(lock.kind); }}>Change PIN or password</button>
            <button className="btn btn-danger" onClick={() => { if (window.confirm('Turn off the app lock?')) { removeLock(); onChange(null, 'App lock is off.'); } }}>Turn off</button>
          </div>
        </>
      ) : editing || !lock ? (
        editing ? (
          <form onSubmit={save}>
            <ErrorBanner message={error} />
            <fieldset className="plain">
              <legend>Use a</legend>
              <label className="check"><input type="radio" name="lockkind" checked={kind === 'pin'} onChange={() => { setKind('pin'); setA(''); setB(''); }} /> PIN (4 to 10 digits)</label>
              <label className="check"><input type="radio" name="lockkind" checked={kind === 'password'} onChange={() => { setKind('password'); setA(''); setB(''); }} /> Password (6 or more characters)</label>
            </fieldset>
            <Field label={kind === 'pin' ? 'New PIN' : 'New password'}>{(id) => <input id={id} type="password" inputMode={kind === 'pin' ? 'numeric' : 'text'} autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} data-autofocus />}</Field>
            <Field label="Type it again">{(id) => <input id={id} type="password" inputMode={kind === 'pin' ? 'numeric' : 'text'} autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />}</Field>
            <Field label="Lock again…">
              {(id) => <select id={id} value={mins} onChange={(e) => setMins(Number(e.target.value))}>{AUTO_LOCK_CHOICES.map((m) => <option key={m} value={m}>{LOCK_WAIT(m)}</option>)}</select>}
            </Field>
            <p className="muted">If you forget it, the only way back in is to erase this device’s data and restore a backup.</p>
            <div className="row">
              <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Turn on app lock'}</button>
              <button type="button" className="btn" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
          </form>
        ) : <button className="btn btn-primary" onClick={() => { setEditing(true); setKind('pin'); setA(''); setB(''); }}>Set up app lock…</button>
      ) : null}
    </section>
  );
}
