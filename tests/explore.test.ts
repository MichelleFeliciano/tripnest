import { describe, expect, it } from 'vitest';
import { describePlace, buildOverpassQuery, haversineKm, itemTypeFor, kindLabel, parsePlaces, MAX_RESULTS } from '../src/lib/explore';

describe('explore: query building', () => {
  it('builds a bounded, named-only query from constants', () => {
    const q = buildOverpassQuery('nature', 18.4655, -66.1057, 10);
    expect(q).toContain('around:10000,18.46550,-66.10570');
    expect(q).toContain('["name"]');
    expect(q).toContain('"natural"~"^(beach|');
    expect(q).toContain('out center tags 500;');
  });
  it('rejects bad coordinates and radii (no injection surface)', () => {
    expect(() => buildOverpassQuery('food', 91, 0, 10)).toThrow();
    expect(() => buildOverpassQuery('food', NaN, 0, 10)).toThrow();
    expect(() => buildOverpassQuery('food', 0, 0, 999)).toThrow();
  });
});

describe('explore: parsing and ranking', () => {
  const resp = {
    elements: [
      { type: 'node', id: 1, lat: 18.47, lon: -66.12, tags: { name: 'Castillo San Felipe del Morro', historic: 'fort', wikipedia: 'en:Castillo', website: 'https://nps.gov/saju', opening_hours: '09:00-17:00' } },
      { type: 'way', id: 2, center: { lat: 18.4601, lon: -66.1 }, tags: { name: 'Small Viewpoint', tourism: 'viewpoint' } },
      { type: 'node', id: 3, lat: 18.47, lon: -66.12, tags: { tourism: 'attraction' } }, // unnamed: dropped
      { type: 'node', id: 4, lat: 18.4601, lon: -66.1, tags: { name: 'Small Viewpoint', tourism: 'viewpoint' } }, // duplicate
      { type: 'node', id: 5, lat: 18.5, lon: -66.1, tags: { name: 'Sketchy Link', tourism: 'attraction', website: 'javascript:alert(1)' } },
    ],
  };
  const places = parsePlaces(resp, 'sights', 18.4655, -66.1057);
  it('drops unnamed and duplicate items; ranks documented places first', () => {
    expect(places.map((p) => p.name)).toEqual(['Castillo San Felipe del Morro', 'Small Viewpoint', 'Sketchy Link']);
  });
  it('computes distance, labels and links', () => {
    expect(places[0].kind).toBe('Fort');
    expect(places[0].osmUrl).toBe('https://www.openstreetmap.org/node/1');
    expect(places[1].distanceKm).toBeGreaterThan(0.3);
    expect(places[1].distanceKm).toBeLessThan(1);
  });
  it('only keeps http(s) websites', () => {
    expect(places[0].website).toBe('https://nps.gov/saju');
    expect(places[2].website).toBeNull();
  });
  it('is safe on garbage and caps the list', () => {
    expect(parsePlaces(null, 'food', 0, 0)).toEqual([]);
    expect(parsePlaces({ elements: 'x' }, 'food', 0, 0)).toEqual([]);
    const many = { elements: Array.from({ length: 200 }, (_, i) => ({ type: 'node', id: i, lat: i / 1000, lon: 0, tags: { name: `P${i}`, amenity: 'cafe' } })) };
    expect(parsePlaces(many, 'food', 0, 0)).toHaveLength(MAX_RESULTS);
  });
  it('helpers', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
    expect(kindLabel({ natural: 'beach' })).toBe('Beach');
    expect(kindLabel({})).toBe('Place');
    expect(itemTypeFor('food')).toBe('restaurant');
    expect(itemTypeFor('sights')).toBe('activity');
  });
  it('filters survey markers and disused places', () => {
    const r = parsePlaces({ elements: [
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { name: 'Survey 4', tourism: 'attraction' } },
      { type: 'node', id: 2, lat: 1, lon: 1.001, tags: { name: 'Test point', tourism: 'attraction' } },
      { type: 'node', id: 3, lat: 1, lon: 1.002, tags: { name: 'Old Fort', historic: 'fort', disused: 'yes' } },
      { type: 'node', id: 4, lat: 1, lon: 1.003, tags: { name: 'Real Beach', natural: 'beach' } },
    ] }, 'nature', 1, 1);
    expect(r.map((p) => p.name)).toEqual(['Real Beach']);
  });
  it('shows only documented places when there are plenty', () => {
    const docs = Array.from({ length: 9 }, (_, i) => ({ type: 'node', id: i, lat: 1, lon: 1 + i / 100, tags: { name: `Landmark ${i}`, tourism: 'attraction', wikipedia: `en:L${i}` } }));
    const plain = { type: 'node', id: 99, lat: 1, lon: 1.5, tags: { name: 'Plain Spot', tourism: 'attraction' } };
    expect(parsePlaces({ elements: [...docs, plain] }, 'sights', 1, 1).some((p) => p.name === 'Plain Spot')).toBe(false);
    expect(parsePlaces({ elements: [docs[0], plain] }, 'sights', 1, 1).some((p) => p.name === 'Plain Spot')).toBe(true);
  });
});

describe('explore: short descriptions', () => {
  const d = (tags: Record<string, string>, kind = 'Place') => describePlace(tags, kind);
  it('prefers what a mapper wrote, with links and stray whitespace removed', () => {
    expect(d({ description: '  Spanish fortress   guarding the bay. See https://example.com/x for tickets.  ' })).toBe('Spanish fortress guarding the bay. See for tickets.');
    expect(d({ 'description:en': 'English text here, please.', description: 'Texto en español aquí.' })).toBe('English text here, please.');
  });
  it('ignores a description too short to mean anything', () => {
    expect(d({ description: 'Nice' })).toBeNull();
  });
  it('cuts a long description at a word boundary', () => {
    const long = 'word '.repeat(80).trim();
    const out = d({ description: long })!;
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1).endsWith('word')).toBe(true);
  });
  it('builds a sentence for restaurants from cuisine and amenities', () => {
    expect(d({ cuisine: 'seafood;puerto_rican', outdoor_seating: 'yes', takeaway: 'yes' }, 'Restaurant')).toBe('Seafood and Puerto Rican restaurant. Has outdoor seating and offers takeaway.');
    expect(d({ cuisine: 'pizza' }, 'Restaurant')).toBe('Pizza restaurant.');
    expect(d({ cuisine: 'italian;pizza' }, 'Restaurant')).toBe('Italian and pizza restaurant.');
  });
  it('describes sights from practical facts, never inventing any', () => {
    expect(d({ fee: 'no', wheelchair: 'yes' })).toBe('Free to visit and wheelchair accessible.');
    expect(d({ fee: 'yes', start_date: '1634', operator: 'National Park Service' })).toBe('Has an entry fee, dates from 1634 and run by National Park Service.');
    expect(d({ natural: 'peak', ele: '1338' })).toBe('1,338 m (4,390 ft) above sea level.');
  });
  it('says nothing when OpenStreetMap has nothing useful, and skips junk values', () => {
    expect(d({})).toBeNull();
    expect(d({ cuisine: 'yes', start_date: 'unknown', ele: 'abc', wheelchair: 'no', fee: 'maybe' })).toBeNull();
    expect(d({ start_date: '2999' })).toBeNull(); // not a date in the past
    expect(d({ operator: 'A'.repeat(60) })).toBeNull();
  });
  it('keeps at most three facts', () => {
    const s = d({ outdoor_seating: 'yes', takeaway: 'yes', fee: 'no', wheelchair: 'yes' })!;
    expect(s).toBe('Has outdoor seating, offers takeaway and free to visit.');
  });
  it('is attached to parsed places', () => {
    const [p] = parsePlaces({ elements: [{ type: 'node', id: 9, lat: 1, lon: 1, tags: { name: 'Playa Flamenco', natural: 'beach', fee: 'no', wheelchair: 'limited' } }] }, 'nature', 1, 1);
    expect(p.summary).toBe('Free to visit and limited wheelchair access.');
  });
});
