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
  /** One or two short sentences built only from what OpenStreetMap says about the place; null when it says nothing useful. */
  summary: string | null;
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

const SUMMARY_MAX = 160;
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const words = (v: string) => v.replace(/_/g, ' ').trim();
const joinAnd = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
/** Cut at a word boundary so a description never ends mid-word. */
function clip(text: string, max = SUMMARY_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).replace(/[\s,;:.-]+$/, '')}…`;
}

/** Nationalities and regions are proper adjectives ("Italian"); dishes and styles are not ("seafood"). */
const PROPER = new Set(['american', 'asian', 'african', 'argentinian', 'brazilian', 'british', 'cajun', 'caribbean', 'chinese', 'colombian', 'cuban', 'dominican', 'ethiopian', 'filipino', 'french', 'german', 'greek', 'hawaiian', 'indian', 'indonesian', 'international', 'irish', 'italian', 'jamaican', 'japanese', 'korean', 'lebanese', 'malaysian', 'mediterranean', 'mexican', 'middle eastern', 'moroccan', 'nepalese', 'peruvian', 'polish', 'portuguese', 'russian', 'spanish', 'tex-mex', 'thai', 'turkish', 'vietnamese']);
function cuisineName(raw: string): string {
  const w = words(raw).toLowerCase();
  const multi = w.includes(' ');
  return PROPER.has(w) || (multi && /^(puerto|latin|new|south|north|central|east|west|middle|san|el|la)\b/.test(w)) ? w.replace(/\b\w/g, (c) => c.toUpperCase()) : w;
}

/**
 * A short description for a place, from its OpenStreetMap tags and nothing else (no guessing, no extra lookups).
 * A mapper-written description wins; otherwise the useful facts are put into a sentence, e.g.
 * "Seafood and Puerto Rican restaurant. Has outdoor seating and offers takeaway." Returns null when there is nothing
 * to say beyond the place type that is already shown as a badge.
 */
export function describePlace(tags: Record<string, string>, kind: string): string | null {
  const written = (tags['description:en'] ?? tags.description ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (written.length >= 12) return clip(written);

  const cuisines = (tags.cuisine ?? '').split(';').map((c) => cuisineName(c)).filter((c) => c && c.toLowerCase() !== 'yes').slice(0, 3);
  const lead = cuisines.length ? `${sentenceCase(joinAnd(cuisines))} ${kind.toLowerCase()}` : null;

  const facts: string[] = [];
  if (tags.outdoor_seating === 'yes') facts.push('has outdoor seating');
  if (tags.takeaway === 'yes' || tags.takeaway === 'only') facts.push('offers takeaway');
  if (tags.fee === 'no') facts.push('free to visit');
  else if (tags.fee === 'yes') facts.push('has an entry fee');
  if (tags.wheelchair === 'yes') facts.push('wheelchair accessible');
  else if (tags.wheelchair === 'limited') facts.push('limited wheelchair access');
  if (tags.heritage || tags['heritage:operator']) facts.push('heritage listed');
  const year = /^~?\s*(\d{3,4})/.exec(tags.start_date ?? '')?.[1];
  if (year && Number(year) <= new Date().getFullYear()) facts.push(`dates from ${year}`);
  const ele = Number(tags.ele);
  if (Number.isFinite(ele) && ele > 0 && (tags.natural === 'peak' || tags.natural === 'cave_entrance')) facts.push(`${Math.round(ele).toLocaleString('en-US')} m (${Math.round(ele * 3.281).toLocaleString('en-US')} ft) above sea level`);
  const operator = (tags.operator ?? '').trim();
  if (operator && operator.length <= 40 && operator.toLowerCase() !== (tags.name ?? '').trim().toLowerCase()) facts.push(`run by ${operator}`);

  const shown = facts.slice(0, 3);
  const rest = shown.length ? `${sentenceCase(joinAnd(shown))}.` : null;
  if (lead && rest) return clip(`${lead}. ${rest}`);
  if (lead) return `${lead}.`;
  return rest ? clip(rest) : null;
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
      summary: describePlace(tags, kindLabel(tags)),
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
