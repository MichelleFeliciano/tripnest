import { useEffect, useState, type FormEvent } from 'react';
import { auth, profiles } from '../api/api';
import { Alert, ErrorBanner, Field } from '../components/ui';
import { useAction } from '../hooks/hooks';
import { useAuth } from '../hooks/contexts';
import { browserTimeZone, COMMON_TIMEZONES, isValidTimeZone } from '../lib/time';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [tz, setTz] = useState('UTC');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const save = useAction();
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
    </main>
  );
}
