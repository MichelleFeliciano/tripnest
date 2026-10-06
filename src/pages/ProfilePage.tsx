import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { account, auth, profiles, type AccountPreview } from '../api/api';
import { Alert, Dialog, ErrorBanner, Field, Spinner } from '../components/ui';
import { useAction } from '../hooks/hooks';
import { useAuth } from '../hooks/contexts';
import { browserTimeZone, COMMON_TIMEZONES, isValidTimeZone } from '../lib/time';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const nav = useNavigate();
  const [delOpen, setDelOpen] = useState(false);
  const [preview, setPreview] = useState<AccountPreview | null>(null);
  const [confirmEmail, setConfirmEmail] = useState('');
  const del = useAction();
  const loadPreview = useAction();
  const save = useAction();

  const openDelete = async () => {
    setDelOpen(true);
    setPreview(null);
    setConfirmEmail('');
    const p = await loadPreview.run(() => account.preview());
    if (p) setPreview(p);
  };
  const doDelete = async () => {
    if (!preview) return;
    const ok = await del.run(async () => { await account.remove(preview.owned_solo.map((t) => t.id)); return true; });
    if (ok) nav('/login?deleted=1', { replace: true });
  };
  const blocked = (preview?.owned_with_others.length ?? 0) > 0;
  const emailMatches = !!user?.email && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();
  const pass = useAction();

  useEffect(() => {
    if (profile) { setName(profile.display_name); setTz(profile.home_timezone); }
  }, [profile]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setMsg(null);
    await save.run(async () => {
      if (!isValidTimeZone(tz)) throw new Error('Choose a valid time zone.');
      await profiles.update(user.id, { display_name: name, home_timezone: tz });
      await refreshProfile();
      setMsg('Profile saved.');
    });
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    await pass.run(async () => {
      if (pw.length < 8) throw new Error('Use a password of at least 8 characters.');
      await auth.updatePassword(pw);
      setPw('');
      setMsg('Password changed.');
    });
  };

  return (
    <main className="container">
      <h1>Profile</h1>
      {msg && <Alert kind="success">{msg}</Alert>}
      <form className="card" onSubmit={submit}>
        <h2>Your details</h2>
        <ErrorBanner message={save.error} />
        <Field label="Email" hint="Your sign-in address">{(id, d) => <input id={id} aria-describedby={d} value={user?.email ?? ''} readOnly />}</Field>
        <Field label="Display name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}</Field>
        <Field label="Home time zone" hint={`Used only as a default. Your device says ${browserTimeZone()}.`}>
          {(id, d) => (
            <>
              <input id={id} aria-describedby={d} list="tz-list" value={tz} onChange={(e) => setTz(e.target.value)} />
              <datalist id="tz-list">{COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </>
          )}
        </Field>
        <button className="btn btn-primary" disabled={save.busy}>Save profile</button>
      </form>
      <form className="card" onSubmit={changePw}>
        <h2>Change password</h2>
        <ErrorBanner message={pass.error} />
        <Field label="New password" hint="At least 8 characters">{(id, d) => <input id={id} aria-describedby={d} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required />}</Field>
        <button className="btn" disabled={pass.busy}>Update password</button>
      </form>

      <section className="card" aria-labelledby="danger-h" style={{ borderColor: 'var(--danger)' }}>
        <h2 id="danger-h">Delete account</h2>
        <p className="muted">Permanently deletes your account. This cannot be undone.</p>
        <button className="btn btn-danger" onClick={openDelete}>Delete my account…</button>
      </section>

      <Dialog open={delOpen} onClose={() => setDelOpen(false)} title="Delete your account?">
        {loadPreview.error && <ErrorBanner message={loadPreview.error} />}
        {!preview && !loadPreview.error && <Spinner label="Checking what this affects…" />}
        {preview && blocked && (
          <>
            <Alert kind="warn">You can't delete your account yet. You own trips that other travelers have joined. Delete those trips (in Trip settings) or remove the other travelers first, so nobody loses a trip unexpectedly.</Alert>
            <ul>{preview.owned_with_others.map((t) => <li key={t.id}><Link to={`/trips/${t.id}/members`} onClick={() => setDelOpen(false)}>{t.name}</Link> ({t.members} other {t.members === 1 ? 'traveler' : 'travelers'})</li>)}</ul>
            <button className="btn" onClick={() => setDelOpen(false)}>Close</button>
          </>
        )}
        {preview && !blocked && (
          <>
            <p><strong>This will:</strong></p>
            <ul>
              <li>Delete your login and profile.</li>
              {preview.owned_solo.length > 0 && <li><strong>Permanently delete {preview.owned_solo.length === 1 ? 'this trip' : 'these trips'}</strong> and everything in {preview.owned_solo.length === 1 ? 'it' : 'them'}, including documents: {preview.owned_solo.map((t) => t.name).join(', ')}.</li>}
              {preview.shared_trips > 0 && <li>Remove you from {preview.shared_trips} {preview.shared_trips === 1 ? 'trip' : 'trips'} you joined. The other travelers keep those trips.</li>}
              {preview.shared_expenses > 0 && <li>Keep {preview.shared_expenses} shared {preview.shared_expenses === 1 ? 'expense' : 'expenses'} you were part of, shown as “Former traveler”, so nobody else's balances change.</li>}
            </ul>
            <ErrorBanner message={del.error} />
            <Field label={`Type your email (${user?.email}) to confirm`}>{(id) => <input id={id} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />}</Field>
            <div className="row">
              <button className="btn btn-danger" disabled={!emailMatches || del.busy} onClick={doDelete}>{del.busy ? 'Deleting…' : 'Permanently delete my account'}</button>
              <button className="btn" onClick={() => setDelOpen(false)} disabled={del.busy}>Cancel</button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  );
}
