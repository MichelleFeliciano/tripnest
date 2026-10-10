import { useState, type FormEvent } from 'react';
import { useToast } from './Toast';
import type { Deleted } from '../api/api';
import { rows } from '../api/api';
import { geocode, parseCoord } from '../api/geocode';
import type { Destination } from '../api/types';
import { useTrip } from '../hooks/contexts';
import { useAction } from '../hooks/hooks';
import { formatDateShort } from '../lib/time';
import { Dialog, ErrorBanner, Field } from './ui';

export default function DestinationsCard() {
  const { data, reload } = useTrip();
  const toast = useToast();
  const [editing, setEditing] = useState<Destination | 'new' | null>(null);
  const [f, setF] = useState({ name: '', country: '', region: '', lat: '', lng: '', arrival: '', departure: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const open = (d: Destination | 'new') => {
    setEditing(d);
    setErr(null);
    setGeo(null);
    setF(d === 'new' ? { name: '', country: '', region: '', lat: '', lng: '', arrival: '', departure: '', notes: '' } : {
      name: d.name, country: d.country ?? '', region: d.region ?? '', lat: d.latitude?.toString() ?? '', lng: d.longitude?.toString() ?? '',
      arrival: d.arrival_date ?? '', departure: d.departure_date ?? '', notes: d.notes ?? '',
    });
  };

  const lookup = async () => {
    setGeo('Looking up…');
    const r = await geocode([f.name, f.region, f.country].filter(Boolean).join(', '));
    if (r) { setF((s) => ({ ...s, lat: r.lat.toFixed(6), lng: r.lng.toFixed(6) })); setGeo('Coordinates filled in.'); }
    else setGeo('Could not find that place. Enter coordinates manually or skip.');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const lat = parseCoord(f.lat, 90);
    const lng = parseCoord(f.lng, 180);
    if (!f.name.trim()) return setErr('Name is required');
    if (lat === 'invalid' || lng === 'invalid') return setErr('Coordinates must be valid numbers');
    if ((lat === null) !== (lng === null)) return setErr('Enter both latitude and longitude, or neither');
    if (f.arrival && f.departure && f.departure < f.arrival) return setErr('Departure cannot be before arrival');
    setErr(null);
    const payload = { trip_id: data.trip.id, name: f.name, country: f.country, region: f.region, latitude: lat, longitude: lng, arrival_date: f.arrival, departure_date: f.departure, notes: f.notes };
    const ok = await run(async () => {
      if (editing === 'new') await rows.insert('destinations', { ...payload, sort_order: data.destinations.length });
      else if (editing) await rows.update('destinations', editing.id, payload);
      return true;
    });
    if (ok) { await reload(); setEditing(null); }
  };

  const remove = async (d: Destination) => {
    if (!window.confirm(`Remove ${d.name}? Itinerary items stay, but lose this destination tag.`)) return;
    let gone: Deleted | undefined;
    const ok = await run(async () => { gone = await rows.remove('destinations', d.id); return true; });
    if (ok) toast.deleted(gone);
    if (ok) { await reload(); setEditing(null); }
  };

  return (
    <section className="card" aria-labelledby="dest-h">
      <div className="row-between"><h2 id="dest-h">Destinations</h2>{<button className="btn btn-sm" onClick={() => open('new')}>+ Add</button>}</div>
      {data.destinations.length === 0 ? <p className="muted">No destinations yet.</p> : (
        <ol className="list">
          {data.destinations.map((d) => (
            <li key={d.id} className="row-between">
              <div>
                <strong>{d.name}</strong>
                <div className="muted">{[d.region, d.country].filter(Boolean).join(', ')}{d.arrival_date && ` · ${formatDateShort(d.arrival_date)}${d.departure_date ? ` – ${formatDateShort(d.departure_date)}` : ''}`}</div>
                {d.notes && <div>{d.notes}</div>}
              </div>
              {<button className="btn btn-sm" onClick={() => open(d)} aria-label={`Edit ${d.name}`}>Edit</button>}
            </li>
          ))}
        </ol>
      )}
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add destination' : 'Edit destination'}>
        <form onSubmit={submit}>
          <ErrorBanner message={error ?? err} />
          <div className="form-grid">
            <Field label="Name *" className="span-2">{(id) => <input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} />}</Field>
            <Field label="Country">{(id) => <input id={id} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} />}</Field>
            <Field label="State / region">{(id) => <input id={id} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} />}</Field>
            <Field label="Arrival date">{(id) => <input id={id} type="date" value={f.arrival} onChange={(e) => setF({ ...f, arrival: e.target.value })} />}</Field>
            <Field label="Departure date">{(id) => <input id={id} type="date" min={f.arrival || undefined} value={f.departure} onChange={(e) => setF({ ...f, departure: e.target.value })} />}</Field>
            <Field label="Latitude">{(id) => <input id={id} inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} />}</Field>
            <Field label="Longitude">{(id) => <input id={id} inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} />}</Field>
            <div className="span-2 row" style={{ marginBottom: 12 }}><button type="button" className="btn btn-sm" onClick={lookup}>Find coordinates (optional)</button>{geo && <span className="muted" role="status">{geo}</span>}</div>
            <Field label="Notes" className="span-2">{(id) => <textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={5000} />}</Field>
          </div>
          <div className="row-between">
            <div className="row"><button className="btn btn-primary" disabled={busy}>Save</button><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button></div>
            {editing && editing !== 'new' && <button type="button" className="btn btn-danger" onClick={() => remove(editing)}>Delete</button>}
          </div>
        </form>
      </Dialog>
    </section>
  );
}
