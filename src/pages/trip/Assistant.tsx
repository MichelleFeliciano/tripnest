import { useState } from 'react';
import { ai, rows } from '../../api/api';
import { AI_ENABLED } from '../../api/supabase';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { addDays } from '../../lib/trip';
import { findConflicts } from '../../lib/itinerary';
import { itemLike } from '../../api/adapters';
import { Alert, ErrorBanner, Field } from '../../components/ui';

interface Idea { day: number; title: string; description?: string }
interface PackCat { name: string; items: string[] }

export default function Assistant() {
  const { data, reload, can } = useTrip();
  const [interests, setInterests] = useState('');
  const [budget, setBudget] = useState('');
  const [activities, setActivities] = useState('');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [pack, setPack] = useState<PackCat[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [cached, setCached] = useState(false);
  const { busy, error, run } = useAction();
  const addAct = useAction();
  const conflicts = findConflicts(data.items.map(itemLike));

  if (!AI_ENABLED) return <Alert kind="info">AI features are turned off for this deployment. TripNest works fully without them.</Alert>;
  const canEdit = can('itinerary.edit');

  const ask = async (kind: 'itinerary' | 'packing' | 'summary') => {
    const r = await run(() => ai.ask(data.trip.id, kind, { interests, budget, activities }));
    if (!r) return;
    setCached(r.cached);
    const res = r.result as { ideas?: Idea[]; categories?: PackCat[]; summary?: string };
    if (kind === 'itinerary') setIdeas(Array.isArray(res.ideas) ? res.ideas.filter((i) => i && typeof i.title === 'string' && Number.isFinite(Number(i.day))).slice(0, 30).map((i) => ({ day: Number(i.day), title: i.title, description: typeof i.description === 'string' ? i.description : '' })) : []);
    if (kind === 'packing') setPack(Array.isArray(res.categories) ? res.categories.filter((c) => c && typeof c.name === 'string' && Array.isArray(c.items)).slice(0, 15).map((c) => ({ name: c.name, items: c.items.filter((x) => typeof x === 'string') })) : []);
    if (kind === 'summary') setSummary(typeof res.summary === 'string' ? res.summary : '');
  };

  const addIdea = async (i: Idea, key: string) => {
    const date = addDays(data.trip.start_date, Math.min(Math.max(1, Math.floor(i.day || 1)), 400) - 1);
    const ok = await addAct.run(async () => { await rows.insert('itinerary_items', { trip_id: data.trip.id, local_date: date, title: i.title.slice(0, 200), description: i.description?.slice(0, 5000), item_type: 'activity' }); return true; });
    if (ok) { setAdded(new Set(added).add(key)); await reload(); }
  };
  const addCat = async (c: PackCat, key: string) => {
    const ok = await addAct.run(async () => {
      const cat = await rows.insert<{ id: string }>('packing_categories', { trip_id: data.trip.id, name: c.name.slice(0, 100), is_shared: true });
      for (const name of c.items.slice(0, 50)) await rows.insert('packing_items', { trip_id: data.trip.id, category_id: cat.id, name: name.slice(0, 200), is_shared: true });
      return true;
    });
    if (ok) { setAdded(new Set(added).add(key)); await reload(); }
  };

  return (
    <div>
      <h2>AI assistant <span className="badge">optional</span></h2>
      <Alert kind="info">Nothing here runs automatically. The assistant is only called when you press a button, suggestions are never added without your OK, and it's never used for money or scheduling math.</Alert>
      <section className="card">
        <div className="form-grid">
          <Field label="Interests">{(id) => <input id={id} value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="beaches, food, history" maxLength={300} />}</Field>
          <Field label="Budget level">{(id) => <input id={id} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="moderate" maxLength={100} />}</Field>
          <Field label="Planned activities (for packing)" className="span-2">{(id) => <input id={id} value={activities} onChange={(e) => setActivities(e.target.value)} placeholder="snorkeling, hiking, nice dinners" maxLength={300} />}</Field>
        </div>
        <div className="row">
          <button className="btn" disabled={busy || !canEdit} onClick={() => ask('itinerary')}>Suggest itinerary ideas</button>
          <button className="btn" disabled={busy || !canEdit} onClick={() => ask('packing')}>Suggest packing list</button>
          <button className="btn" disabled={busy} onClick={() => ask('summary')}>Summarize trip</button>
        </div>
        <ErrorBanner message={error ?? addAct.error} />
        {busy && <p role="status">Thinking…</p>}
        {cached && <p className="muted">Showing a saved result for identical inputs (no new AI call).</p>}
      </section>

      <section className="card" aria-labelledby="conf">
        <h3 id="conf">Schedule check (no AI needed)</h3>
        {conflicts.length === 0 ? <p>No overlapping items found.</p> : <ul>{conflicts.map((c) => <li key={c.a + c.b}>{c.reason}</li>)}</ul>}
      </section>

      {summary && <section className="card"><h3>Summary</h3><p style={{ whiteSpace: 'pre-wrap' }}>{summary}</p></section>}
      {ideas && (
        <section className="card"><h3>Itinerary ideas</h3>
          {ideas.length === 0 ? <p>No ideas returned.</p> : <ul className="list">{ideas.map((i, n) => (
            <li key={n} className="row-between"><div><strong>Day {i.day}: {i.title}</strong><div className="muted">{i.description}</div></div>
              <button className="btn btn-sm" disabled={added.has(`i${n}`) || addAct.busy} onClick={() => addIdea(i, `i${n}`)}>{added.has(`i${n}`) ? 'Added ✓' : 'Add to itinerary'}</button></li>
          ))}</ul>}
        </section>
      )}
      {pack && (
        <section className="card"><h3>Packing suggestions</h3>
          {pack.map((c, n) => (
            <div key={n} className="row-between"><div><strong>{c.name}</strong><div className="muted">{c.items.join(', ')}</div></div>
              <button className="btn btn-sm" disabled={added.has(`p${n}`) || addAct.busy} onClick={() => addCat(c, `p${n}`)}>{added.has(`p${n}`) ? 'Added ✓' : 'Add to shared list'}</button></div>
          ))}
        </section>
      )}
    </div>
  );
}
