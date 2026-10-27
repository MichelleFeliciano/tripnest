import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTrip } from '../../hooks/contexts';
import { buildSearchDocs, SEARCH_LABEL as LABEL, SEARCH_PATH as PATH } from '../../api/searchDocs';
import { searchDocs, type SearchDoc } from '../../lib/search';

export default function SearchPage() {
  const { data, me } = useTrip();
  const [q, setQ] = useState('');
  const docs = useMemo<SearchDoc[]>(() => buildSearchDocs(data, me), [data, me]);
  const results = useMemo(() => searchDocs(docs, q), [docs, q]);

  return (
    <div>
      <h2>Search this trip</h2>
      <div className="field"><label htmlFor="q">Search itinerary, reservations, notes, packing, to-dos and expenses</label><input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. dinner, ABC123, sunscreen" /></div>
      <p role="status" aria-live="polite" className="muted">{q.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : ''}</p>
      <ul className="list card" hidden={!q.trim()}>
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`}><span className="badge">{LABEL[r.kind]}</span> <Link to={`../${PATH[r.kind]}`}><strong>{r.title}</strong></Link>{r.detail && <span className="muted"> · {r.detail}</span>}</li>
        ))}
      </ul>
    </div>
  );
}
