import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../api/api';
import { supabase } from '../api/supabase';
import { Alert, ErrorBanner, Field } from '../components/ui';
import { useAction } from '../hooks/hooks';
import { useAuth } from '../hooks/contexts';

type Mode = 'in' | 'up' | 'forgot';

export function LoginPage() {
  const { user } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const from = (loc.state as { from?: string } | null)?.from;
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run, setError } = useAction();

  if (user) return <Navigate to={from && from.startsWith('/') ? from : '/trips'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    await run(async () => {
      if (mode === 'in') {
        await auth.signIn(email, password);
        nav(from && from.startsWith('/') ? from : '/trips', { replace: true });
      } else if (mode === 'up') {
        if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
        const r = await auth.signUp(email, password, name);
        setNotice(r.session ? 'Welcome to TripNest!' : 'Check your email to confirm your address, then log in.');
      } else {
        await auth.resetPassword(email);
        setNotice('If an account exists for that email, a reset link is on its way.');
      }
    });
  };

  const titles: Record<Mode, string> = { in: 'Log in', up: 'Create your account', forgot: 'Reset your password' };
  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <h1>{titles[mode]}</h1>
      <form className="card" onSubmit={submit} noValidate={false}>
        <ErrorBanner message={error} />
        {notice && <Alert kind="success">{notice}</Alert>}
        {mode === 'up' && (
          <Field label="Your name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />}</Field>
        )}
        <Field label="Email">{(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
        {mode !== 'forgot' && (
          <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}>
            {(id, d) => <input id={id} aria-describedby={d} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required minLength={mode === 'up' ? 8 : undefined} />}
          </Field>
        )}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Please wait…' : titles[mode]}</button>
        <div className="row-between" style={{ marginTop: 12 }}>
          {mode !== 'in' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('in'); setError(null); }}>Back to log in</button>}
          {mode === 'in' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('forgot'); setError(null); }}>Forgot password?</button>}
          {mode === 'in' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setMode('up'); setError(null); }}>Create account</button>}
        </div>
      </form>
    </main>
  );
}

/** Landing page of the emailed recovery link: Supabase signs the user in, then they choose a new password. */
export function ResetPasswordPage() {
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [pw, setPw] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await run(async () => {
      if (pw.length < 8) throw new Error('Use a password of at least 8 characters.');
      await auth.updatePassword(pw);
      await supabase.auth.signOut();
      setDone(true);
      setTimeout(() => nav('/login'), 1500);
    });
  };
  return (
    <main className="container" style={{ maxWidth: 440 }}>
      <h1>Choose a new password</h1>
      {done ? <Alert kind="success">Password updated. Redirecting to log in…</Alert> : !loading && !user ? (
        <Alert kind="warn">This reset link is invalid or has expired. Request a new one from the log-in page.</Alert>
      ) : (
        <form className="card" onSubmit={submit}>
          <ErrorBanner message={error} />
          <Field label="New password" hint="At least 8 characters">{(id, d) => <input id={id} aria-describedby={d} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required minLength={8} />}</Field>
          <button className="btn btn-primary" disabled={busy}>Update password</button>
        </form>
      )}
    </main>
  );
}
