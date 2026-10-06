/**
 * "What is there to do" discovery from OpenStreetMap (Overpass API). Pure functions only:
 * query building, response parsing, ranking. Network access lives in src/api/explore.ts.
 */
export const EXPLORE_CATEGORIES = ['sights', 'museums', 'food', 'nature', 'fun'] as const;
export type ExploreCategory = (typeof EXPLORE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExploreCategory, string> = {
  sights: 'Sights & landmarks',
  museums: 'Museums & history',
  food: 'Food & drink',
  nature: 'Beaches & nature',
  fun: 'Fun & activities',
};
export const CATEGORY_ICONS: Record<ExploreCategory, string> = { sights: '📸', museums: '🏛️', food: '🍽️', nature: '🏖️', fun: '🎡' };

/** [OSM key, allowed values]. Constants only, never user text, so queries cannot be injected into. */
const FILTERS: Record<ExploreCategory, [string, string][]> = {
  sights: [['tourism', 'attraction|viewpoint'], ['historic', 'castle|fort|monument|memorial|ruins|city_gate']],
  museums: [['tourism', 'museum|gallery'], ['historic', 'building|house|archaeological_site']],
  food: [['amenity', 'restaurant|cafe|bar|pub|ice_cream|food_court']],
  nature: [['natural', 'beach|waterfall|peak|bay|cave_entrance|hot_spring'], ['leisure', 'park|nature_reserve|garden']],
  fun: [['tourism', 'zoo|theme_park|aquarium'], ['leisure', 'water_park|marina|golf_course|miniature_golf|bowling_alley']],
};

export const RADII_KM = [3, 10, 25] as const;
export const MAX_RESULTS = 40;

export function buildOverpassQuery(cat: ExploreCategory, lat: number, lng: number, radiusKm: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates');
  if (!(RADII_KM as readonly number[]).includes(radiusKm)) throw new Error('Invalid radius');
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(5)},${lng.toFixed(5)})`;
  const parts = FILTERS[cat].map(([k, v]) => `nwr["name"]["${k}"~"^(${v})$"]${around};`).join('');
  return `[out:json][timeout:25];(${parts});out center tags 500;`;
}

export interface Place {
  id: string; // e.g. "node/123"
  name: string;
  kind: string; // human label, e.g. "Beach"
  category: ExploreCategory;
  lat: number;
  lng: number;
  distanceKm: number;
  website: string | null;
  address: string | null;
  openingHours: string | null;
  osmUrl: string;
  score: number;
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mapper survey markers, test objects and the like that pollute OSM "attraction" tags. */
const JUNK_NAME = /^(survey|test|temp|tmp|fixme|todo|marker|unnamed)(\s|\d|$)|^(n\/a|na)$|^\W*$|^.{1,2}$/i;

const KIND_KEYS = ['tourism', 'historic', 'natural', 'leisure', 'amenity'];
export function kindLabel(tags: Record<string, string>): string {
  for (const k of KIND_KEYS) {
    const v = tags[k];
    if (v && v !== 'yes') return v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
  return 'Place';
}

const safeUrl = (u: string | undefined): string | null => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

function addressOf(t: Record<string, string>): string | null {
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const parts = [street, t['addr:city']].filter(Boolean).join(', ');
  return parts || null;
}

/** Parse an Overpass response, drop unnamed/duplicate items, rank, and cap the list. */
export function parsePlaces(json: unknown, cat: ExploreCategory, centerLat: number, centerLng: number): Place[] {
  const elements = (json as { elements?: OsmElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    const name = (tags.name ?? '').trim();
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!name || name.length > 200 || typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (JUNK_NAME.test(name) || tags.disused || tags['disused:tourism'] || tags.abandoned === 'yes') continue;
    const dedupe = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const website = safeUrl(tags.website) ?? safeUrl(tags['contact:website']);
    const distanceKm = haversineKm(centerLat, centerLng, lat, lng);
    // Well-documented places (Wikipedia/Wikidata, a website, opening hours) are usually the notable ones.
    const score = (tags.wikipedia || tags.wikidata ? 3 : 0) + (website ? 1 : 0) + (tags.opening_hours ? 0.5 : 0) + (tags.cuisine || tags.description ? 0.5 : 0);
    out.push({
      id: `${e.type}/${e.id}`,
      name,
      kind: kindLabel(tags),
      category: cat,
      lat,
      lng,
      distanceKm,
      website,
      address: addressOf(tags),
      openingHours: tags.opening_hours?.slice(0, 200) ?? null,
      osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      score,
    });
  }
  out.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
  // Plenty of well-documented places? Show only those; otherwise pad with the rest.
  const documented = out.filter((p) => p.score > 0);
  return (documented.length >= 8 ? documented : out).slice(0, MAX_RESULTS);
}

export function itemTypeFor(cat: ExploreCategory): 'restaurant' | 'activity' {
  return cat === 'food' ? 'restaurant' : 'activity';
}
