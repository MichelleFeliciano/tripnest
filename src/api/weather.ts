import { ApiError } from './api';
import { parseWeather, planWeather, weatherUrl, type WeatherDay, type WeatherRequest } from '../lib/weather';

const TTL_MS = { forecast: 3 * 3_600_000, actual: 7 * 86_400_000, typical: 7 * 86_400_000 } as const;
const cacheKey = (url: string) => `tripnest:weather:v1:${url}`;

function readCache(url: string, ttl: number): unknown | null {
  try {
    const raw = localStorage.getItem(cacheKey(url));
    if (!raw) return null;
    const { t, json } = JSON.parse(raw) as { t: number; json: unknown };
    return Date.now() - t < ttl ? json : null;
  } catch { return null; }
}
function writeCache(url: string, json: unknown) {
  try { localStorage.setItem(cacheKey(url), JSON.stringify({ t: Date.now(), json })); } catch { /* quota or private mode: just refetch next time */ }
}

async function fetchOne(req: WeatherRequest, lat: number, lng: number, force: boolean): Promise<WeatherDay[]> {
  const url = weatherUrl(req, lat, lng);
  if (!force) {
    const hit = readCache(url, TTL_MS[req.kind]);
    if (hit) try { return parseWeather(hit, req); } catch { /* bad cache entry: fall through and refetch */ }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) throw new ApiError('The free weather service is busy right now. Please try again in a few minutes.');
    if (!res.ok) throw new ApiError('Weather is unavailable right now. The rest of TripNest still works.');
    const json = await res.json();
    const days = parseWeather(json, req); // validate before caching
    writeCache(url, json);
    return days;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("Couldn't load the weather. Check your connection and try again. The rest of TripNest still works.");
  } finally {
    clearTimeout(timer);
  }
}

export interface TripWeather { days: WeatherDay[]; unavailable: string[]; truncated: boolean }

/** Weather for the first 16 days of a trip at one place. Only called after the person opts in. */
export async function loadTripWeather(tripStart: string, tripEnd: string, today: string, lat: number, lng: number, force = false): Promise<TripWeather> {
  const plan = planWeather(tripStart, tripEnd, today);
  const parts = await Promise.all(plan.requests.map((r) => fetchOne(r, lat, lng, force)));
  const days = parts.flat().sort((a, b) => a.date.localeCompare(b.date));
  return { days, unavailable: plan.unavailable, truncated: plan.truncated };
}
