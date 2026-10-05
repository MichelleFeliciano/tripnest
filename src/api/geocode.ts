/** Optional, user-initiated lookup via OpenStreetMap Nominatim. Failure is non-fatal. */
export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { lat: string; lon: string }[];
    if (!j[0]) return null;
    const lat = Number(j[0].lat);
    const lng = Number(j[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

export function parseCoord(s: string, max: number): number | null | 'invalid' {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : 'invalid';
}
