import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { members } from '../api/api';
import { Alert, ErrorBanner, Spinner } from '../components/ui';
import { useAction } from '../hooks/hooks';

interface Preview { trip_name: string; role: string; status: string; expires_at: string }

export default function InvitePage() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const act = useAction();

  useEffect(() => {
    members.preview(token).then(setP).catch((e: Error) => setErr(e.message));
  }, [token]);

  const accept = async () => {
    const r = await act.run(() => members.accept(token));
    if (r?.status === 'accepted' && r.trip_id) nav(`/trips/${r.trip_id}`, { replace: true });
    else if (r) setP((cur) => (cur ? { ...cur, status: r.status } : cur));
  };
  const decline = async () => {
    const r = await act.run(() => members.decline(token));
    if (r) setDeclined(true);
  };

  if (err) return <main className="container"><h1>Invitation</h1><Alert>{err}</Alert><Link to="/trips">Go to my trips</Link></main>;
  if (!p) return <Spinner />;
  const roleText = p.role === 'editor' ? 'edit' : 'view';
  return (
    <main className="container" style={{ maxWidth: 520 }}>
      <h1>You're invited</h1>
      <div className="card">
        <h2>{p.trip_name}</h2>
        {declined ? <Alert kind="info">You declined this invitation.</Alert> : p.status === 'pending' ? (
          <>
            <p>You've been invited to {roleText} this trip as {p.role === 'editor' ? 'an' : 'a'} <strong>{p.role}</strong>.</p>
            <ErrorBanner message={act.error} />
            <div className="row">
              <button className="btn btn-primary" onClick={accept} disabled={act.busy}>Accept invitation</button>
              <button className="btn" onClick={decline} disabled={act.busy}>Decline</button>
            </div>
          </>
        ) : (
          <Alert kind="warn">This invitation is {p.status} and can no longer be used. Ask the trip owner for a new one.</Alert>
        )}
      </div>
      <Link to="/trips">Go to my trips</Link>
    </main>
  );
}
