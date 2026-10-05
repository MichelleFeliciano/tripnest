import { useState, type FormEvent } from 'react';
import { rows } from '../../api/api';
import { nameOf } from '../../api/adapters';
import type { Note, NoteScope } from '../../api/types';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { Empty, ErrorBanner, Field } from '../../components/ui';

const SCOPES: [NoteScope, string][] = [['trip', 'Trip'], ['destination', 'Destination'], ['itinerary', 'Itinerary item'], ['reservation', 'Reservation']];

export default function Notes() {
  const { data, me, reload, can, } = useTrip();
  const [scope, setScope] = useState<NoteScope>('trip');
  const [target, setTarget] = useState('');
  const [body, setBody] = useState('');
  const [filter, setFilter] = useState<NoteScope | 'all'>('all');
  const { busy, error, run } = useAction();

  const targets: { id: string; label: string }[] =
    scope === 'destination' ? data.destinations.map((d) => ({ id: d.id, label: d.name }))
    : scope === 'itinerary' ? data.items.map((i) => ({ id: i.id, label: `${i.local_date} · ${i.title}` }))
    : scope === 'reservation' ? data.reservations.map((r) => ({ id: r.id, label: r.title }))
    : [];
  const label = (n: Note) => {
    if (n.scope === 'trip') return 'Trip';
    const t = n.scope === 'destination' ? data.destinations.find((d) => d.id === n.target_id)?.name : n.scope === 'itinerary' ? data.items.find((i) => i.id === n.target_id)?.title : data.reservations.find((r) => r.id === n.target_id)?.title;
    return `${SCOPES.find(([s]) => s === n.scope)![1]}: ${t ?? '(removed)'}`;
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || (scope !== 'trip' && !target)) return;
    const ok = await run(async () => { await rows.insert('notes', { trip_id: data.trip.id, scope, target_id: scope === 'trip' ? null : target, body, created_by: me }); return true; });
    if (ok) { setBody(''); await reload(); }
  };
  const del = async (n: Note) => {
    if (!window.confirm('Delete this note?')) return;
    const ok = await run(async () => { await rows.remove('notes', n.id); return true; });
    if (ok) await reload();
  };

  const list = data.notes.filter((n) => filter === 'all' || n.scope === filter);
  return (
    <div>
      <h2>Notes</h2>
      {can('notes.edit') && (
        <form className="card" onSubmit={add}>
          <ErrorBanner message={error} />
          <div className="form-grid">
            <Field label="Note about">{(id) => <select id={id} value={scope} onChange={(e) => { setScope(e.target.value as NoteScope); setTarget(''); }}>{SCOPES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>}</Field>
            {scope !== 'trip' && <Field label="Which one?">{(id) => <select id={id} value={target} onChange={(e) => setTarget(e.target.value)} required><option value="">Choose…</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>}</Field>}
            <Field label="Note" className="span-2">{(id) => <textarea id={id} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} required />}</Field>
          </div>
          <button className="btn btn-primary" disabled={busy}>Add note</button>
        </form>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <label htmlFor="nf" className="muted">Show</label>
        <select id="nf" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as NoteScope | 'all')}><option value="all">All notes</option>{SCOPES.map(([s, l]) => <option key={s} value={s}>{l}</option>)}</select>
      </div>
      {data.trip.notes && filter !== 'destination' && filter !== 'itinerary' && filter !== 'reservation' && <div className="card"><div className="muted">Trip description notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{data.trip.notes}</p></div>}
      {list.length === 0 ? <Empty title="No notes yet" /> : list.map((n) => (
        <div key={n.id} className="card">
          <div className="row-between"><strong>{label(n)}</strong>{can('notes.edit') && (n.created_by === me || data.role === 'owner') && <button className="btn btn-sm btn-ghost" onClick={() => del(n)} aria-label="Delete note">Delete</button>}</div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
          <small className="muted">{nameOf(data, n.created_by)} · {new Date(n.created_at).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}
