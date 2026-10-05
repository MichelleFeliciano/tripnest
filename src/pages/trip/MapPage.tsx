import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrip } from '../../hooks/contexts';
import { ITEM_ICONS, ITEM_LABELS } from '../../lib/itinerary';
import { Alert, Empty } from '../../components/ui';

interface Pin { id: string; lat: number; lng: number; title: string; kind: string; detail: string }

const osmLink = (p: Pin) => `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=15/${p.lat}/${p.lng}`;

export default function MapPage() {
  const { data } = useTrip();
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  const pins = useMemo<Pin[]>(() => [
    ...data.destinations.filter((d) => d.latitude !== null && d.longitude !== null).map((d) => ({ id: d.id, lat: d.latitude!, lng: d.longitude!, title: d.name, kind: '📍 Destination', detail: [d.region, d.country].filter(Boolean).join(', ') })),
    ...data.items.filter((i) => i.latitude !== null && i.longitude !== null).map((i) => ({ id: i.id, lat: i.latitude!, lng: i.longitude!, title: i.title, kind: `${ITEM_ICONS[i.item_type]} ${ITEM_LABELS[i.item_type]}`, detail: [i.location_name, i.address].filter(Boolean).join(' · ') })),
  ], [data.destinations, data.items]);

  useEffect(() => {
    if (!pins.length || !el.current) return;
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    (async () => {
      try {
        const [L] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !el.current) return;
        map = L.map(el.current, { scrollWheelZoom: false });
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' })
          .on('tileerror', () => setFailed(true))
          .addTo(map);
        const bounds = L.latLngBounds([]);
        for (const p of pins) {
          // Popup content is built from DOM text nodes, never HTML strings, so user text cannot inject markup.
          const box = document.createElement('div');
          const h = document.createElement('strong'); h.textContent = p.title;
          const k = document.createElement('div'); k.textContent = p.kind;
          const d = document.createElement('div'); d.textContent = p.detail;
          box.append(h, k, d);
          L.circleMarker([p.lat, p.lng], { radius: 9, weight: 2, color: '#0f766e', fillColor: '#2dd4bf', fillOpacity: 0.9 }).addTo(map).bindPopup(box);
          bounds.extend([p.lat, p.lng]);
        }
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      } catch {
        setFailed(true);
      }
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [pins]);

  return (
    <div>
      <h2>Map</h2>
      {pins.length === 0 ? (
        <Empty title="No mapped places yet">Add coordinates to a destination or itinerary item (use “Find coordinates” in the form) to see it here.</Empty>
      ) : (
        <>
          {failed && <Alert kind="warn">The map couldn't load. The list below has everything, with links to open each place.</Alert>}
          <div ref={el} className="map" role="region" aria-label="Map of trip locations. A full list follows." />
          <p className="muted">Map data © OpenStreetMap contributors.</p>
        </>
      )}
      {pins.length > 0 && (
        <section className="card" aria-labelledby="loc-h">
          <h3 id="loc-h">Locations</h3>
          <ul className="list">
            {pins.map((p) => (
              <li key={p.id}><strong>{p.title}</strong> <span className="muted">· {p.kind}</span>{p.detail && <div className="muted">{p.detail}</div>}
                <a href={osmLink(p)} target="_blank" rel="noopener noreferrer">Open in map ({p.lat.toFixed(3)}, {p.lng.toFixed(3)})</a></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
