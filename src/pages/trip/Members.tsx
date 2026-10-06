import { useState, type FormEvent } from 'react';
import { members as api } from '../../api/api';
import { useTrip } from '../../hooks/contexts';
import { appUrl } from '../../lib/appUrl';
import { useAction } from '../../hooks/hooks';
import { Alert, ErrorBanner, Field } from '../../components/ui';

export default function Members() {
  const { data, me, reload, can } = useTrip();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const isOwner = data.role === 'owner';

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setLink(null);
    setCopied(false);
    const token = await run(() => api.invite(data.trip.id, email, role));
    if (token) { setLink({ email, url: appUrl(`invite/${token}`) }); setEmail(''); await reload(); }
  };
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); } catch { setCopied(false); }
  };
  const act = async (fn: () => Promise<unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    const ok = await run(async () => { await fn(); return true; });
    if (ok) await reload();
  };

  const nowIso = Date.now();
  const effective = (i: (typeof data.invitations)[number]) => (i.status === 'pending' && Date.parse(i.expires_at) < nowIso ? 'expired' : i.status);

  return (
    <div>
      <h2>Travelers</h2>
      <ErrorBanner message={error} />
      <section className="card" aria-labelledby="mem-h">
        <h3 id="mem-h">Members</h3>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Trip members and their roles</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.user_id}>
                  <th scope="row">{m.profile?.display_name || m.profile?.email}{m.user_id === me && ' (you)'}<div className="muted" style={{ fontWeight: 400 }}>{m.profile?.email}</div></th>
                  <td>
                    {isOwner && m.role !== 'owner' ? (
                      <select aria-label={`Role for ${m.profile?.display_name}`} value={m.role} onChange={(e) => act(() => api.setRole(data.trip.id, m.user_id, e.target.value as 'editor' | 'viewer'))} style={{ width: 'auto' }}>
                        <option value="editor">Editor</option><option value="viewer">Viewer</option>
                      </select>
                    ) : <span className="badge">{m.role[0].toUpperCase() + m.role.slice(1)}</span>}
                  </td>
                  <td>
                    {isOwner && m.role !== 'owner' && <button className="btn btn-sm btn-danger" onClick={() => act(() => api.remove(data.trip.id, m.user_id), `Remove ${m.profile?.display_name}? They will lose access to this trip.`)}>Remove</button>}
                    {m.user_id === me && m.role !== 'owner' && <button className="btn btn-sm" onClick={() => act(() => api.remove(data.trip.id, me), 'Leave this trip?')}>Leave</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">Owner: everything. Editor: itinerary, reservations, packing, expenses, notes, documents. Viewer: read-only.</p>
      </section>

      {can('members.invite') && (
        <section className="card" aria-labelledby="inv-h">
          <h3 id="inv-h">Invite a traveler</h3>
          <form onSubmit={invite}>
            <div className="form-grid">
              <Field label="Email address">{(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />}</Field>
              <Field label="Role">{(id) => <select id={id} value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}><option value="editor">Editor: can plan and add expenses</option><option value="viewer">Viewer: read-only</option></select>}</Field>
            </div>
            <button className="btn btn-primary" disabled={busy}>Create invitation</button>
          </form>
          {link && (
            <Alert kind="success">
              <p style={{ margin: 0 }}>Invitation for <strong>{link.email}</strong> created. Send them this link (it only works when they sign in with that email, and expires in 7 days). For security it is shown only now.</p>
              <div className="row" style={{ marginTop: 8 }}><input readOnly value={link.url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} /><button className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button></div>
            </Alert>
          )}
          {data.invitations.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <caption>Invitations</caption>
                <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {data.invitations.map((i) => (
                    <tr key={i.id}><td>{i.email}</td><td>{i.role}</td><td>{effective(i)}{effective(i) === 'pending' && ` · expires ${new Date(i.expires_at).toLocaleDateString()}`}</td>
                      <td><button className="btn btn-sm" onClick={() => act(() => api.revoke(i.id))}>{effective(i) === 'pending' ? 'Revoke' : 'Remove'}</button></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
