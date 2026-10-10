import { directionsUrl, hasMapTarget, mapsApp, mapsUrl, type Place } from '../lib/maps';

/** "Open in Maps" and "Directions" for a place with coordinates or an address. Shows nothing when there is nothing to look up. */
export default function MapLinks({ place }: { place: Place }) {
  if (!hasMapTarget(place)) return null;
  const app = mapsApp({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints });
  const name = (place.name ?? '').trim();
  const where = app === 'apple' ? 'Apple Maps' : 'Google Maps';
  return (
    <div className="row no-print map-links">
      <a href={mapsUrl(place, app)!} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name || 'this place'} in ${where} (opens a new tab)`}><span aria-hidden="true">📍 </span>Open in Maps</a>
      <a href={directionsUrl(place, app)!} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${name || 'this place'} in ${where} (opens a new tab)`}><span aria-hidden="true">🧭 </span>Directions</a>
    </div>
  );
}
