import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTrip } from '../../hooks/contexts';
import { nameOf } from '../../api/adapters';
import { searchDocs, type SearchDoc } from '../../lib/search';
import { formatMoney } from '../../lib/money';
import { formatDateShort } from '../../lib/time';
import { visibleItems } from '../../lib/packing';
import { packingLike } from '../../api/adapters';

const LABEL: Record<SearchDoc['kind'], string> = { itinerary: 'Itinerary', reservation: 'Reservation', note: 'Note', packing: 'Packing', expense: 'Expense' };
const PATH: Record<SearchDoc['kind'], string> = { itinerary: 'itinerary', reservation: 'reservations', note: 'notes', packing: 'packing', expense: 'expenses' };

export default function SearchPage() {
  const { data, me } = useTrip();
  const [q, setQ] = useState('');
  const docs = useMemo<SearchDoc[]>(() => {
    const visible = new Set(visibleItems(data.packingItems.map(packingLike), me).map((i) => i.id));
    return [
      ...data.items.map((i): SearchDoc => ({ kind: 'itinerary', id: i.id, title: i.title, detail: `${formatDateShort(i.local_date)}${i.location_name ? ` · ${i.location_name}` : ''}`, haystack: [i.description, i.address, i.notes, i.confirmation_number, i.contact, i.website].filter(Boolean).join(' ') })),
      ...data.reservations.map((r): SearchDoc => ({ kind: 'reservation', id: r.id, title: r.title, detail: r.provider ?? '', haystack: [r.confirmation_number, r.address, r.notes, r.phone, ...Object.values(r.details ?? {})].filter(Boolean).join(' ') })),
      ...data.notes.map((n): SearchDoc => ({ kind: 'note', id: n.id, title: n.body.slice(0, 80), detail: '', haystack: n.body })),
      ...data.packingItems.filter((p) => visible.has(p.id)).map((p): SearchDoc => ({ kind: 'packing', id: p.id, title: p.name, detail: p.packed ? 'Packed' : 'Not packed', haystack: p.notes ?? '' })),
      ...data.expenses.map((e): SearchDoc => ({ kind: 'expense', id: e.id, title: e.description, detail: `${formatMoney(e.amount_cents, e.currency)} · ${nameOf(data, e.paid_by)}`, haystack: `${e.category} ${e.notes ?? ''}` })),
    ];
  }, [data, me]);
  const results = useMemo(() => searchDocs(docs, q), [docs, q]);

  return (
    <div>
      <h2>Search this trip</h2>
      <div className="field"><label htmlFor="q">Search itinerary, reservations, notes, packing and expenses</label><input id="q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. dinner, ABC123, sunscreen" /></div>
      <p role="status" aria-live="polite" className="muted">{q.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : ''}</p>
      <ul className="list card" hidden={!q.trim()}>
        {results.map((r) => (
          <li key={`${r.kind}-${r.id}`}><span className="badge">{LABEL[r.kind]}</span> <Link to={`../${PATH[r.kind]}`}><strong>{r.title}</strong></Link>{r.detail && <span className="muted"> · {r.detail}</span>}</li>
        ))}
      </ul>
    </div>
  );
}
