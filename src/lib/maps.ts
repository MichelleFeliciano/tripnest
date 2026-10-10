/**
 * "Open in Maps" links. Pure: builds a web address for the phone's maps app. Nothing is requested by TripNest itself;
 * the link only does something when the person taps it.
 *  - iPhone and iPad: Apple Maps (the app people there have)
 *  - everything else: Google Maps (opens its app on Android, the website elsewhere)
 */
export interface Place {
  name?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}
export type MapsApp = 'apple' | 'google';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
const validCoords = (p: Place): p is Place & { latitude: number; longitude: number } =>
  typeof p.latitude === 'number' && typeof p.longitude === 'number' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

export function mapsApp(nav: { userAgent: string; platform: string; maxTouchPoints: number }): MapsApp {
  const iPad13 = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1; // iPadOS reports itself as a Mac
  return /iPhone|iPad|iPod/.test(nav.userAgent) || iPad13 ? 'apple' : 'google';
}

/** What to search for: exact coordinates are best; otherwise the address (with the place name to help); otherwise the name. */
function queryOf(p: Place): string | null {
  if (validCoords(p)) return `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
  const address = clean(p.address);
  const name = clean(p.name);
  if (address) return name && !address.toLowerCase().includes(name.toLowerCase()) ? `${name}, ${address}` : address;
  return name || null;
}

/** True when there is anything to look up. A place with only a name still works, but is a weak search, so it is not offered. */
export function hasMapTarget(p: Place): boolean {
  return validCoords(p) || clean(p.address).length > 0;
}

export function mapsUrl(p: Place, app: MapsApp): string | null {
  if (!hasMapTarget(p)) return null;
  const q = encodeURIComponent(queryOf(p)!);
  const label = clean(p.name);
  if (app === 'apple') return validCoords(p) && label ? `https://maps.apple.com/?ll=${q}&q=${encodeURIComponent(label)}` : `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function directionsUrl(p: Place, app: MapsApp): string | null {
  if (!hasMapTarget(p)) return null;
  const q = encodeURIComponent(queryOf(p)!);
  return app === 'apple' ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
