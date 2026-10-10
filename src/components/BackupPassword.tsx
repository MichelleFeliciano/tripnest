import { useRef, useState, type FormEvent } from 'react';
import { passwordProblem } from '../api/crypto';
import { Dialog, Field } from './ui';

/** "Protect with a password" for the page that saves a backup. `password` is null when protection is off or not yet valid. */
export function useProtectOption() {
  const [on, setOn] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const problem = !on ? null : passwordProblem(pw) ?? (pw !== pw2 ? 'The two passwords do not match.' : null);
  return { on, pw, pw2, problem, password: on && !problem ? pw : null, set: { on: setOn, pw: setPw, pw2: setPw2 } };
}

export function ProtectOption({ o }: { o: ReturnType<typeof useProtectOption> }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label className="check"><input type="checkbox" checked={o.on} onChange={(e) => o.set.on(e.target.checked)} /> Protect with a password</label>
      {o.on && (
        <div className="form-grid">
          <Field label="Password" hint="At least 8 characters">{(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={o.pw} onChange={(e) => o.set.pw(e.target.value)} />}</Field>
          <Field label="Type it again" error={o.pw2 && o.problem ? o.problem : undefined}>{(id) => <input id={id} type="password" autoComplete="new-password" value={o.pw2} onChange={(e) => o.set.pw2(e.target.value)} />}</Field>
          <p className="muted span-2">Write the password down somewhere safe. <strong>If you forget it, nobody can open the backup, including us</strong>: it is never stored or sent anywhere.</p>
        </div>
      )}
    </div>
  );
}

/** Asks for a password when a protected file is opened. `ask` resolves to the password, or null if the person cancels. */
export function usePasswordPrompt() {
  const [state, setState] = useState<{ wasWrong: boolean } | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((p: string | null) => void) | null>(null);

  const ask = (wasWrong: boolean) => new Promise<string | null>((resolve) => { resolver.current = resolve; setValue(''); setState({ wasWrong }); });
  const finish = (p: string | null) => { const r = resolver.current; resolver.current = null; setState(null); r?.(p); };
  const submit = (e: FormEvent) => { e.preventDefault(); if (value) finish(value); };

  const dialog = (
    <Dialog open={state !== null} onClose={() => finish(null)} title="This file is password protected">
      <form onSubmit={submit}>
        <Field label="Password" error={state?.wasWrong ? 'That password did not open the file. Check it and try again.' : undefined}>
          {(id) => <input id={id} type="password" autoComplete="current-password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        <div className="row"><button className="btn btn-primary" disabled={!value}>Open</button><button type="button" className="btn" onClick={() => finish(null)}>Cancel</button></div>
      </form>
    </Dialog>
  );
  return { ask, dialog };
}
