import { useState, type FormEvent } from 'react';
import { travelers as api } from '../../api/api';
import { useToast } from '../../components/Toast';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { ErrorBanner, Field } from '../../components/ui';

/** The people on this trip. They are just names (no accounts), used for splitting costs and assigning packing items. */
export default function Travelers() {
  const { data, reload } = useTrip();
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const { busy, error, run } = useAction();

  const act = async (fn: () => Promise<unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return false;
    const ok = await run(async () => { await fn(); return true; });
    if (ok) await reload();
    return !!ok;
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api.add(data.trip.id, name))) setName('');
  };
  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    if (editing && (await act(() => api.rename(editing.id, editing.name)))) setEditing(null);
  };

  return (
    <div>
      <h2>Travelers</h2>
      <p className="muted">Who is on this trip. Everything is stored on this device, so these are simply names used to split costs and share out packing, not accounts.</p>
      <ErrorBanner message={error} />
      <section className="card" aria-labelledby="who-h">
        <h3 id="who-h">On this trip ({data.travelers.length})</h3>
        <ul className="list">
          {data.travelers.map((t) => (
            <li key={t.id} className="row-between">
              {editing?.id === t.id ? (
                <form className="row" onSubmit={saveName} style={{ flex: 1 }}>
                  <label className="sr-only" htmlFor={`rn-${t.id}`}>New name for {t.name}</label>
                  <input id={`rn-${t.id}`} value={editing.name} onChange={(e) => setEditing({ id: t.id, name: e.target.value })} maxLength={80} autoFocus style={{ maxWidth: 240 }} />
                  <button className="btn btn-sm btn-primary" disabled={busy}>Save</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div><strong>{t.name}</strong> {t.is_me && <span className="badge">You</span>}</div>
                  <div className="row">
                    {!t.is_me && <button className="btn btn-sm" onClick={() => act(() => api.setMe(data.trip.id, t.id))} aria-label={`Make ${t.name} the traveler this device belongs to`}>This is me</button>}
                    <button className="btn btn-sm" onClick={() => setEditing({ id: t.id, name: t.name })} aria-label={`Rename ${t.name}`}>Rename</button>
                    <button className="btn btn-sm btn-danger" onClick={() => act(async () => { toast.deleted(await api.remove(t.id)); }, `Remove ${t.name} from this trip?`)} aria-label={`Remove ${t.name}`}>Remove</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">Anyone who appears in an expense or payment can't be removed until those are deleted, so balances never change by accident.</p>
      </section>

      <form className="card" onSubmit={add}>
        <h3>Add a traveler</h3>
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Jon" />}</Field>
        <button className="btn btn-primary" disabled={busy}>Add traveler</button>
      </form>
    </div>
  );
}
