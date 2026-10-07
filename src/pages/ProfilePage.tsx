import { useEffect, useRef, useState, type FormEvent } from 'react';
import { backupFileName, eraseEverything, exportData, parseBackup, restoreAll } from '../api/backup';
import { storageEstimate } from '../api/db';
import { getSettings, saveSettings } from '../api/settings';
import { Alert, Dialog, ErrorBanner, Field, download } from '../components/ui';
import { useAction } from '../hooks/hooks';
import { browserTimeZone, COMMON_TIMEZONES, isValidTimeZone } from '../lib/time';

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function ProfilePage() {
  const [name, setName] = useState(getSettings().display_name);
  const [tz, setTz] = useState(getSettings().home_timezone);
  const [msg, setMsg] = useState<string | null>(null);
  const [withFiles, setWithFiles] = useState(true);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof storageEstimate>>>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<ReturnType<typeof parseBackup> | null>(null);
  const save = useAction();
  const backup = useAction();
  const restore = useAction();
  const erase = useAction();

  useEffect(() => { void storageEstimate().then(setUsage); }, [msg]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!isValidTimeZone(tz)) return void save.run(async () => { throw new Error('Choose a valid time zone.'); });
    saveSettings({ display_name: name, home_timezone: tz });
    setMsg('Saved.');
  };

  const doBackup = async () => {
    setMsg(null);
    const file = await backup.run(() => exportData({ includeFiles: withFiles }));
    if (file) { download(backupFileName(), JSON.stringify(file), 'application/json'); setMsg('Backup downloaded. Keep it somewhere safe, like your email or cloud drive.'); }
  };

  const onRestorePick = async (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    const parsed = await restore.run(async () => parseBackup(await f.text()));
    if (restoreRef.current) restoreRef.current.value = '';
    if (parsed) setPendingRestore(parsed);
  };
  const doRestore = async () => {
    if (!pendingRestore) return;
    const ok = await restore.run(async () => { await restoreAll(pendingRestore); return true; });
    if (ok) { setPendingRestore(null); setMsg('Backup restored.'); }
  };
  const doErase = async () => {
    const ok = await erase.run(async () => { await eraseEverything(); return true; });
    if (ok) { setEraseOpen(false); setConfirmText(''); setName(''); setMsg('Everything on this device was erased.'); }
  };

  return (
    <main className="container">
      <h1>Profile</h1>
      {msg && <Alert kind="success">{msg}</Alert>}

      <form className="card" onSubmit={submit}>
        <h2>About you</h2>
        <p className="muted">There are no accounts. Your trips live in this browser on this device, and only you can see them.</p>
        <ErrorBanner message={save.error} />
        <Field label="Your name" hint="Used as the first traveler on new trips">{(id, d) => <input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />}</Field>
        <Field label="Home time zone" hint={`Used only as a default. Your device says ${browserTimeZone()}.`}>
          {(id, d) => (
            <>
              <input id={id} aria-describedby={d} list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
              <datalist id="tz-list">{COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </>
          )}
        </Field>
        <button className="btn btn-primary">Save</button>
      </form>

      <section className="card" aria-labelledby="bk-h">
        <h2 id="bk-h">Back up and restore</h2>
        <p>Because everything is stored only on this device, a backup file protects you if the browser data is cleared or you get a new phone. It also lets you move trips to another device.</p>
        <ErrorBanner message={backup.error ?? restore.error} />
        <label className="check"><input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} /> Include uploaded documents (makes the file bigger)</label>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={doBackup} disabled={backup.busy}>{backup.busy ? 'Preparing…' : 'Download a backup'}</button>
          <label className="btn">
            Restore from a backup…
            <input ref={restoreRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onRestorePick(e.target.files?.[0])} />
          </label>
        </div>
        <p className="muted">To add a single trip from a file without replacing anything, use <strong>Import a trip file</strong> on the Trips page.</p>
        {usage && <p className="muted">Using {mb(usage.usedBytes)} of this device's allowance{usage.persistent ? '. Your browser has promised to keep it.' : '. Your browser may clear it if the device runs low on space, so back up now and then.'}</p>}
      </section>

      <section className="card" aria-labelledby="er-h" style={{ borderColor: 'var(--danger)' }}>
        <h2 id="er-h">Erase everything</h2>
        <p className="muted">Removes every trip, expense, document and setting from this device. This cannot be undone. Download a backup first if you might want anything back.</p>
        <button className="btn btn-danger" onClick={() => { setConfirmText(''); setEraseOpen(true); }}>Erase all data on this device…</button>
      </section>

      <Dialog open={pendingRestore !== null} onClose={() => setPendingRestore(null)} title="Replace everything with this backup?">
        {pendingRestore && (
          <>
            <p>This backup has <strong>{pendingRestore.tables.trips.length}</strong> {pendingRestore.tables.trips.length === 1 ? 'trip' : 'trips'}
              {pendingRestore.exportedAt && <> (saved {new Date(pendingRestore.exportedAt).toLocaleDateString()})</>}. Restoring <strong>replaces all trips currently on this device</strong>.</p>
            <ul>{pendingRestore.tables.trips.slice(0, 8).map((t) => <li key={t.id}>{String(t.name)}</li>)}</ul>
            <ErrorBanner message={restore.error} />
            <div className="row">
              <button className="btn btn-danger" onClick={doRestore} disabled={restore.busy}>{restore.busy ? 'Restoring…' : 'Replace everything'}</button>
              <button className="btn" onClick={() => setPendingRestore(null)}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={eraseOpen} onClose={() => setEraseOpen(false)} title="Erase all data?">
        <p>Every trip and document on this device will be permanently deleted.</p>
        <ErrorBanner message={erase.error} />
        <Field label="Type ERASE to confirm">{(id) => <input id={id} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />}</Field>
        <div className="row">
          <button className="btn btn-danger" disabled={confirmText.trim() !== 'ERASE' || erase.busy} onClick={doErase}>{erase.busy ? 'Erasing…' : 'Erase everything'}</button>
          <button className="btn" onClick={() => setEraseOpen(false)}>Cancel</button>
        </div>
      </Dialog>
    </main>
  );
}
