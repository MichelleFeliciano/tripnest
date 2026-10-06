import { useState } from 'react';
import { Link } from 'react-router-dom';
import { rows } from '../../api/api';
import { geocode } from '../../api/geocode';
import { findPlaces } from '../../api/explore';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { CATEGORY_ICONS, CATEGORY_LABELS, EXPLORE_CATEGORIES, RADII_KM, itemTypeFor, type ExploreCategory, type Place } from '../../lib/explore';
import { dayIndex, tripDates } from '../../lib/trip';
import { formatDateShort } from '../../lib/time';
import { Alert, Empty, ErrorBanner, SafeLink } from '../../components/ui';

const OTHER = '__other';

export default function Explore() {
  const { data, reload, can } = useTrip();
  const dates = tripDates(data.trip.start_date, data.trip.end_date);
  const [where, setWhere] = useState(data.destinations[0]?.id ?? OTHER);
  const [other, setOther] = useState('');
  const [cat, setCat] = useState<ExploreCategory>('sights');
  const [radius, setRadius] = useState<(typeof RADII_KM)[number]>(10);
  const [day, setDay] = useState(dates[0]);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [meta, setMeta] = useState<{ label: string; cached: boolean; geocodedFor?: string; center?: { lat: number; lng: number } } | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const search = useAction();
  const add = useAction();
  const canEdit = can('itinerary.edit');
  const dest = data.destinations.find((d) => d.id === where);

  const go = async (force = false) => {
    setPlaces(null);
    const res = await search.run(async () => {
      let lat = dest?.latitude ?? null;
      let lng = dest?.longitude ?? null;
      const label = dest?.name ?? other.trim();
      let geocodedFor: string | undefined;
      if (lat === null || lng === null) {
        const q = dest ? [dest.name, dest.region, dest.country].filter(Boolean).join(', ') : other.trim();
        if (!q) throw new Error('Enter a place to explore.');
        const g = await geocode(q);
        if (!g) throw new Error(`Couldn't find "${q}" on the map. Try a more specific name, or add coordinates to the destination.`);
        lat = g.lat;
        lng = g.lng;
        geocodedFor = dest?.id;
      }
      const r = await findPlaces(cat, lat, lng, radius, force);
      return { ...r, label, geocodedFor, center: { lat, lng } };
    });
    if (res) {
      setPlaces(res.places);
      setMeta({ label: res.label, cached: res.cached, geocodedFor: res.geocodedFor, center: res.center });
    }
  };

  const saveLocation = async () => {
    if (!meta?.geocodedFor || !meta.center) return;
    const ok = await add.run(async () => { await rows.update('destinations', meta.geocodedFor!, { latitude: meta.center!.lat, longitude: meta.center!.lng }); return true; });
    if (ok) { await reload(); setMeta({ ...meta, geocodedFor: undefined }); }
  };

  const addToItinerary = async (p: Place) => {
    const ok = await add.run(async () => {
      await rows.insert('itinerary_items', {
        trip_id: data.trip.id, local_date: day, title: p.name.slice(0, 200), item_type: itemTypeFor(p.category),
        description: `${p.kind}${p.openingHours ? ` · Hours: ${p.openingHours}` : ''}`.slice(0, 5000), location_name: p.name.slice(0, 200),
        address: p.address?.slice(0, 300), latitude: Number(p.lat.toFixed(6)), longitude: Number(p.lng.toFixed(6)), website: p.website,
        destination_id: dest?.id ?? null,
      });
      return true;
    });
    if (ok) { setAdded((s) => new Set(s).add(p.id)); await reload(); }
  };

  return (
    <div>
      <h2>Explore</h2>
      <p className="muted">Find things to do near your destinations. Suggestions come from OpenStreetMap and are only looked up when you press Search. Always double-check hours and bookings before you go.</p>

      <section className="card" aria-label="Search options">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ex-where">Where</label>
            <select id="ex-where" value={where} onChange={(e) => setWhere(e.target.value)}>
              {data.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value={OTHER}>Another place…</option>
            </select>
          </div>
          {where === OTHER ? (
            <div className="field"><label htmlFor="ex-other">Place name</label><input id="ex-other" value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Rincón, Puerto Rico" maxLength={200} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void go(); } }} /></div>
          ) : (
            <div className="field">
              <label htmlFor="ex-r">Distance</label>
              <select id="ex-r" value={radius} onChange={(e) => setRadius(Number(e.target.value) as (typeof RADII_KM)[number])}>{RADII_KM.map((r) => <option key={r} value={r}>Within {r} km ({Math.round(r * 0.621)} mi)</option>)}</select>
            </div>
          )}
          {where === OTHER && (
            <div className="field">
              <label htmlFor="ex-r2">Distance</label>
              <select id="ex-r2" value={radius} onChange={(e) => setRadius(Number(e.target.value) as (typeof RADII_KM)[number])}>{RADII_KM.map((r) => <option key={r} value={r}>Within {r} km ({Math.round(r * 0.621)} mi)</option>)}</select>
            </div>
          )}
        </div>
        <div className="seg" role="group" aria-label="What are you looking for?" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {EXPLORE_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}><span aria-hidden="true">{CATEGORY_ICONS[c]} </span>{CATEGORY_LABELS[c]}</button>)}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void go()} disabled={search.busy || (where === OTHER && !other.trim())}>{search.busy ? 'Searching…' : 'Find things to do'}</button>
          {canEdit && (
            <label className="row">Add to
              <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} aria-label="Itinerary day for added places">
                {dates.map((d) => <option key={d} value={d}>Day {dayIndex(data.trip.start_date, d)} · {formatDateShort(d)}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <ErrorBanner message={search.error ?? add.error} />
      {search.busy && <p role="status" className="muted">Looking nearby… this can take up to 30 seconds.</p>}

      {meta?.geocodedFor && canEdit && (
        <Alert kind="info">
          Located {meta.label} on the map. <button className="btn btn-sm" onClick={saveLocation} disabled={add.busy}>Save this location to the destination</button> so it also appears on the trip map.
        </Alert>
      )}

      {places && (
        <section aria-labelledby="ex-res">
          <h3 id="ex-res">{CATEGORY_LABELS[cat]} near {meta?.label}</h3>
          <p className="muted" role="status">{places.length} {places.length === 1 ? 'place' : 'places'}{meta?.cached ? ' (saved result from earlier today)' : ''}. Better-documented places are listed first.{' '}
            {meta?.cached && <button className="btn btn-sm" onClick={() => void go(true)}>Refresh</button>}</p>
          {places.length === 0 ? <Empty title="Nothing found">Try a larger distance or another category. OpenStreetMap coverage varies by area.</Empty> : (
            <ul className="list card">
              {places.map((p) => (
                <li key={p.id}>
                  <div className="row-between">
                    <div>
                      <strong>{p.name}</strong> <span className="badge">{p.kind}</span>
                      <div className="muted">{p.distanceKm.toFixed(1)} km away{p.address ? ` · ${p.address}` : ''}</div>
                      {p.openingHours && <div className="muted">Hours: {p.openingHours}</div>}
                      <div className="row" style={{ gap: 12 }}>
                        {p.website && <SafeLink href={p.website}>Website</SafeLink>}
                        <a href={p.osmUrl} target="_blank" rel="noopener noreferrer">Map details</a>
                      </div>
                    </div>
                    {canEdit && <button className="btn btn-sm" disabled={added.has(p.id) || add.busy} onClick={() => addToItinerary(p)} aria-label={`Add ${p.name} to itinerary`}>{added.has(p.id) ? 'Added ✓' : '+ Itinerary'}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Place data © OpenStreetMap contributors (ODbL). Added places are never changed automatically; you can edit them on the <Link to="../itinerary">itinerary</Link>.</p>
        </section>
      )}
      {!places && !search.busy && !search.error && data.destinations.length === 0 && <Alert kind="info">Add a destination on the Overview page, or choose “Another place…”.</Alert>}
    </div>
  );
}
