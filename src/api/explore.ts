import { ApiError } from './api';
import { buildOverpassQuery, parsePlaces, type ExploreCategory, type Place } from '../lib/explore';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const TTL_MS = 24 * 60 * 60 * 1000;
const key = (c: ExploreCategory, lat: number, lng: number, r: number) => `tripnest:explore:v3:${c}:${lat.toFixed(2)}:${lng.toFixed(2)}:${r}`;

function readCache(k: string): Place[] | null {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const { t, places } = JSON.parse(raw) as { t: number; places: Place[] };
    return Date.now() - t < TTL_MS ? places : null;
  } catch {
    return null;
  }
}

/**
 * Fetches nearby places from OpenStreetMap. Only called when the user asks.
 * Results are cached on-device for 24 h to be kind to the free public service.
 * Any failure is reported as a friendly message; nothing else in the app depends on this.
 */
export async function findPlaces(cat: ExploreCategory, lat: number, lng: number, radiusKm: number, force = false): Promise<{ places: Place[]; cached: boolean }> {
  const k = key(cat, lat, lng, radiusKm);
  if (!force) {
    const hit = readCache(k);
    if (hit) return { places: hit, cached: true };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(buildOverpassQuery(cat, lat, lng, radiusKm))}`,
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status === 504) throw new ApiError('The free map service is busy right now. Please try again in a minute.');
    if (!res.ok) throw new ApiError('Suggestions are unavailable right now. The rest of TripNest still works.');
    const places = parsePlaces(await res.json(), cat, lat, lng);
    try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), places })); } catch { /* quota/private mode */ }
    return { places, cached: false };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Couldn't load suggestions. Check your connection and try again. The rest of TripNest still works.");
  } finally {
    clearTimeout(timer);
  }
}
