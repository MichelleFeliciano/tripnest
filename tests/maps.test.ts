/** "Open in Maps" links. */
import { describe, expect, it } from 'vitest';
import { directionsUrl, hasMapTarget, mapsApp, mapsUrl } from '../src/lib/maps';

describe('maps links', () => {
  const hotel = { name: 'Hotel El Convento', address: '100 Calle del Cristo, San Juan', latitude: 18.4663, longitude: -66.1167 };

  it('picks Apple Maps on iPhone and iPad, Google Maps everywhere else', () => {
    const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints });
    expect(mapsApp(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit', 'iPhone', 5))).toBe('apple');
    expect(mapsApp(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 5))).toBe('apple'); // iPad pretending to be a Mac
    expect(mapsApp(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 'MacIntel', 0))).toBe('google'); // a real Mac
    expect(mapsApp(nav('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', 'Linux armv8l', 5))).toBe('google');
    expect(mapsApp(nav('Mozilla/5.0 (Windows NT 10.0) Chrome/120', 'Win32', 0))).toBe('google');
  });

  it('prefers exact coordinates, and labels the pin in Apple Maps', () => {
    expect(mapsUrl(hotel, 'google')).toBe('https://www.google.com/maps/search/?api=1&query=18.466300%2C-66.116700');
    expect(mapsUrl(hotel, 'apple')).toBe('https://maps.apple.com/?ll=18.466300%2C-66.116700&q=Hotel%20El%20Convento');
    expect(directionsUrl(hotel, 'google')).toBe('https://www.google.com/maps/dir/?api=1&destination=18.466300%2C-66.116700');
    expect(directionsUrl(hotel, 'apple')).toBe('https://maps.apple.com/?daddr=18.466300%2C-66.116700');
  });

  it('falls back to the address, adding the name unless the address already has it', () => {
    expect(mapsUrl({ name: 'La Factoría', address: '148 Calle San Sebastián' }, 'google')).toBe('https://www.google.com/maps/search/?api=1&query=La%20Factor%C3%ADa%2C%20148%20Calle%20San%20Sebasti%C3%A1n');
    expect(mapsUrl({ name: 'Hotel', address: 'Hotel El Convento, San Juan' }, 'google')).toBe('https://www.google.com/maps/search/?api=1&query=Hotel%20El%20Convento%2C%20San%20Juan');
    expect(mapsUrl({ address: '1 Main St' }, 'apple')).toBe('https://maps.apple.com/?q=1%20Main%20St');
  });

  it('offers nothing for a place we cannot locate (a bare name is too vague)', () => {
    expect(hasMapTarget({ name: 'Beach day' })).toBe(false);
    expect(mapsUrl({ name: 'Beach day' }, 'google')).toBeNull();
    expect(directionsUrl({}, 'apple')).toBeNull();
    expect(hasMapTarget({ address: '   ' })).toBe(false);
  });

  it('ignores impossible coordinates and falls back to the address', () => {
    for (const bad of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 1 }, { latitude: 1, longitude: null }, { latitude: null, longitude: null }]) {
      expect(mapsUrl({ address: '1 Main St', ...bad }, 'google')).toBe('https://www.google.com/maps/search/?api=1&query=1%20Main%20St');
      expect(hasMapTarget(bad)).toBe(false);
    }
    expect(hasMapTarget({ latitude: 0, longitude: 0 })).toBe(true); // 0,0 is a valid place, not "missing"
  });

  it('cannot be used to inject anything into the link', () => {
    const url = mapsUrl({ address: 'x&query=evil#frag?y=1 "><script>' }, 'google')!;
    expect(url.startsWith('https://www.google.com/maps/search/?api=1&query=')).toBe(true);
    expect(url).not.toMatch(/[<>" ]/);
    expect(new URL(url).searchParams.get('query')).toBe('x&query=evil#frag?y=1 "><script>');
    expect(new URL(url).hash).toBe('');
  });

  it('trims long text to a sensible length', () => {
    const q = new URL(mapsUrl({ address: 'a'.repeat(500) }, 'google')!).searchParams.get('query')!;
    expect(q.length).toBe(200);
  });
});
