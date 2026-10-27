import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly, loadTrip, trips } from '../api/api';
import { buildSearchDocs, SEARCH_LABEL, SEARCH_PATH } from '../api/searchDocs';
import { Alert, Spinner } from '../components/ui';
import { searchDocs, type SearchDoc } from '../lib/search';

interface Hit extends SearchDoc { tripId: string; tripName: string }

/** One search box for everything on this device: trips, itinerary, reservations, notes, packing, to-dos and expenses. */
export default function GlobalSearchPage() {
  const [docs, setDocs] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const all: Hit[] = [];
        for (const t of await trips.list()) {
          all.push({ kind: 'trip', id: t.id, title: t.name, detail: t.primary_destination ?? '', haystack: `${t.description ?? ''} ${t.notes ?? ''}`, tripId: t.id, tripName: t.name });
          const d = await loadTrip(t.id);
          for (const x of buildSearchDocs(d, d.me)) all.push({ ...x, tripId: t.id, tripName: t.name });
        }
        if (alive) setDocs(all);
      } catch (e) { if (alive) setError(friendly(e).message); }
    })();
    return () => { alive = false; };
  }, []);

  const results = useMemo(() => {
    if (!docs) return [];
    const found = new Set(searchDocs(docs, q));
    return docs.filter((d) => found.has(d));
  }, [docs, q]);

  return (
    <main className="container">
      <h1>Search everything</h1>
      {error && <Alert>{error}</Alert>}
      {!docs && !error && <Spinner label="Getting your trips ready to search…" />}
      {docs && (
        <>
          <div className="field">
            <label htmlFor="gq">Search all your trips</label>
            <input id="gq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Lisbon, ABC123, sunscreen, dinner" autoFocus />
          </div>
          <p role="status" aria-live="polite" className="muted">{q.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : `${docs.length} things to search across your trips.`}</p>
          <ul className="list card" hidden={!q.trim()}>
            {results.map((r) => (
              <li key={`${r.tripId}-${r.kind}-${r.id}`}>
                <span className="badge">{SEARCH_LABEL[r.kind]}</span>{' '}
                <Link to={r.kind === 'trip' ? `/trips/${r.tripId}` : `/trips/${r.tripId}/${SEARCH_PATH[r.kind]}`}><strong>{r.title}</strong></Link>
                {r.detail && <span className="muted"> · {r.detail}</span>}
                {r.kind !== 'trip' && <span className="muted"> · in {r.tripName}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
