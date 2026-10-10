/** Weather: which service answers which date, parsing, labels, units, packing hints, and caching. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORECAST_AHEAD_DAYS, FORECAST_BACK_DAYS, WEATHER_MAX_DAYS, defaultUnit, describeCode, isWet, packingHints, parseWeather, planWeather, toUnit, weatherUrl, yearBefore,
  type WeatherDay, type WeatherRequest,
} from '../src/lib/weather';
import { addDays } from '../src/lib/tasks';
import { loadTripWeather } from '../src/api/weather';

const TODAY = '2027-06-10';

describe('yearBefore', () => {
  it('keeps the calendar date and turns 29 Feb into 28 Feb', () => {
    expect(yearBefore('2027-06-12')).toBe('2026-06-12');
    expect(yearBefore('2028-02-29')).toBe('2027-02-28');
    expect(yearBefore('2028-03-01')).toBe('2027-03-01');
  });
});

describe('planWeather', () => {
  it('sends near dates to the forecast, with the edges exactly at 15 days ahead and 92 days back', () => {
    const p = planWeather(addDays(TODAY, FORECAST_AHEAD_DAYS - 1), addDays(TODAY, FORECAST_AHEAD_DAYS), TODAY);
    expect(p.requests.map((r) => r.kind)).toEqual(['forecast']);
    const old = planWeather(addDays(TODAY, -FORECAST_BACK_DAYS), addDays(TODAY, -FORECAST_BACK_DAYS + 1), TODAY);
    expect(old.requests.map((r) => r.kind)).toEqual(['forecast']);
  });
  it('sends older dates to the archive as what actually happened', () => {
    const p = planWeather(addDays(TODAY, -FORECAST_BACK_DAYS - 3), addDays(TODAY, -FORECAST_BACK_DAYS - 1), TODAY);
    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]).toMatchObject({ kind: 'actual', start: addDays(TODAY, -FORECAST_BACK_DAYS - 3), end: addDays(TODAY, -FORECAST_BACK_DAYS - 1) });
  });
  it('uses the same dates a year earlier for trips further ahead', () => {
    const p = planWeather('2027-09-01', '2027-09-03', TODAY);
    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]).toMatchObject({ kind: 'typical', start: '2026-09-01', end: '2026-09-03' });
    expect(p.requests[0].dates).toEqual([{ trip: '2027-09-01', source: '2026-09-01' }, { trip: '2027-09-02', source: '2026-09-02' }, { trip: '2027-09-03', source: '2026-09-03' }]);
  });
  it('splits a trip that straddles the forecast window into two requests', () => {
    const p = planWeather(addDays(TODAY, 14), addDays(TODAY, 17), TODAY);
    expect(p.requests.map((r) => [r.kind, r.dates.length])).toEqual([['forecast', 2], ['typical', 2]]);
  });
  it('says so when last year is too recent to be in the archive yet', () => {
    // Two years out: a year earlier is still in the future.
    const p = planWeather('2029-06-01', '2029-06-02', TODAY);
    expect(p.requests).toEqual([]);
    expect(p.unavailable).toEqual(['2029-06-01', '2029-06-02']);
  });
  it(`shows at most ${WEATHER_MAX_DAYS} days and says when it cut the trip short`, () => {
    const p = planWeather(TODAY, addDays(TODAY, 40), TODAY);
    expect(p.requests.reduce((n, r) => n + r.dates.length, 0) + p.unavailable.length).toBe(WEATHER_MAX_DAYS);
    expect(p.truncated).toBe(true);
    expect(planWeather(TODAY, addDays(TODAY, 3), TODAY).truncated).toBe(false);
  });
});

describe('weatherUrl', () => {
  const req = (kind: WeatherRequest['kind']): WeatherRequest => ({ kind, start: '2027-06-10', end: '2027-06-12', dates: [] });
  it('picks the right service and asks for the destination time zone', () => {
    const f = weatherUrl(req('forecast'), 18.4655, -66.1057);
    expect(f).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=18\.4655&longitude=-66\.1057/);
    expect(f).toContain('precipitation_probability_max');
    expect(f).toContain('timezone=auto');
    const a = weatherUrl(req('typical'), 1, 2);
    expect(a).toMatch(/^https:\/\/archive-api\.open-meteo\.com\/v1\/archive/);
    expect(a).not.toContain('precipitation_probability_max');
  });
  it('refuses nonsense coordinates', () => {
    expect(() => weatherUrl(req('forecast'), 91, 0)).toThrow();
    expect(() => weatherUrl(req('forecast'), 0, NaN)).toThrow();
  });
});

const reply = (time: string[], extra: Record<string, unknown> = {}) => ({
  daily: { time, weather_code: time.map(() => 61), temperature_2m_max: time.map(() => 30), temperature_2m_min: time.map(() => 22), precipitation_sum: time.map(() => 4.2), ...extra },
});

describe('parseWeather', () => {
  const req: WeatherRequest = { kind: 'typical', start: '2026-09-01', end: '2026-09-02', dates: [{ trip: '2027-09-01', source: '2026-09-01' }, { trip: '2027-09-02', source: '2026-09-02' }] };
  it('maps archive dates onto trip dates and remembers where the numbers came from', () => {
    const days = parseWeather(reply(['2026-09-01', '2026-09-02']), req);
    expect(days.map((d) => [d.date, d.basedOn, d.kind, d.maxC, d.precipMm, d.precipChance])).toEqual([
      ['2027-09-01', '2026-09-01', 'typical', 30, 4.2, null], ['2027-09-02', '2026-09-02', 'typical', 30, 4.2, null],
    ]);
  });
  it('keeps missing numbers as null, and skips dates the service did not return', () => {
    const days = parseWeather(reply(['2026-09-01'], { temperature_2m_max: [null] }), req);
    expect(days).toHaveLength(1);
    expect(days[0].maxC).toBeNull();
  });
  it('rejects replies that are not the expected shape instead of showing bad data', () => {
    for (const bad of [null, {}, { daily: {} }, { daily: { time: 'x' } }, reply(['2026-09-01'], { weather_code: [1, 2, 3] }), { daily: { time: [5] } }]) {
      expect(() => parseWeather(bad, req)).toThrow(/Unexpected/);
    }
  });
  it('ignores non-numeric values rather than trusting them', () => {
    const d = parseWeather(reply(['2026-09-01'], { temperature_2m_max: ['hot'], weather_code: ['61'] }), req)[0];
    expect(d.maxC).toBeNull();
    expect(d.code).toBeNull();
  });
});

describe('labels, units and hints', () => {
  it('describes weather codes', () => {
    expect(describeCode(0).label).toBe('Clear');
    expect(describeCode(63).label).toBe('Rain');
    expect(describeCode(95).label).toBe('Thunderstorms');
    expect(describeCode(null).label).toBe('No data');
    expect(describeCode(1234).label).toBe('Mixed');
  });
  it('converts and rounds temperatures, and guesses a unit from the locale', () => {
    expect(toUnit(0, 'F')).toBe(32);
    expect(toUnit(100, 'F')).toBe(212);
    expect(toUnit(21.6, 'C')).toBe(22);
    expect(toUnit(null, 'F')).toBeNull();
    expect(defaultUnit('en-US')).toBe('F');
    expect(defaultUnit('en-GB')).toBe('C');
    expect(defaultUnit('es_PR')).toBe('C');
    expect(defaultUnit('en')).toBe('C');
  });
  const day = (o: Partial<WeatherDay>): WeatherDay => ({ date: '2027-06-10', kind: 'forecast', basedOn: null, code: 0, maxC: 22, minC: 14, precipMm: 0, precipChance: 0, ...o });
  it('decides what counts as a wet day', () => {
    expect(isWet(day({}))).toBe(false);
    expect(isWet(day({ precipChance: 60 }))).toBe(true);
    expect(isWet(day({ precipMm: 2 }))).toBe(true);
    expect(isWet(day({ code: 63, precipChance: null, precipMm: null }))).toBe(true);
    expect(isWet(day({ code: 73, precipChance: null, precipMm: null }))).toBe(false); // snow gets its own hint
  });
  it('suggests packing only for what the days actually show', () => {
    expect(packingHints([])).toEqual([]);
    expect(packingHints([day({})])).toEqual([]);
    const hints = packingHints([day({ precipChance: 80 }), day({ minC: 5 }), day({ maxC: 31 }), day({ code: 73 })]);
    expect(hints).toEqual([
      'Rain on 1 of 4 days: pack a rain jacket or umbrella.',
      'Cool mornings or evenings: bring a warm layer.',
      'Hot days: sunscreen, a hat and a refillable water bottle.',
      'Snow possible: waterproof boots and warm gloves.',
    ]);
  });
});

describe('loadTripWeather', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

  it('fetches once per service, and serves repeat views from the on-device cache', async () => {
    const fetchMock = vi.fn(async (url: string) => ok(reply(url.includes('archive') ? ['2026-09-01', '2026-09-02'] : ['2027-06-11', '2027-06-12'])));
    vi.stubGlobal('fetch', fetchMock);
    const w = await loadTripWeather('2027-06-11', '2027-06-12', TODAY, 18.4, -66.1);
    expect(w.days.map((d) => d.date)).toEqual(['2027-06-11', '2027-06-12']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await loadTripWeather('2027-06-11', '2027-06-12', TODAY, 18.4, -66.1);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
    await loadTripWeather('2027-06-11', '2027-06-12', TODAY, 18.4, -66.1, true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // refresh bypasses the cache
  });
  it('combines forecast and typical days in date order', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ok(reply(url.includes('archive') ? ['2026-06-26', '2026-06-27'] : ['2027-06-24', '2027-06-25']))));
    const w = await loadTripWeather('2027-06-24', '2027-06-27', TODAY, 18.4, -66.1);
    expect(w.days.map((d) => [d.date, d.kind])).toEqual([['2027-06-24', 'forecast'], ['2027-06-25', 'forecast'], ['2027-06-26', 'typical'], ['2027-06-27', 'typical']]);
  });
  it('turns failures into friendly messages and never caches a bad reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response));
    await expect(loadTripWeather('2027-06-11', '2027-06-12', TODAY, 1, 2)).rejects.toThrow(/busy/);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    await expect(loadTripWeather('2027-06-11', '2027-06-12', TODAY, 1, 2)).rejects.toThrow(/unavailable/);
    vi.stubGlobal('fetch', vi.fn(async () => ok({ nonsense: true })));
    await expect(loadTripWeather('2027-06-11', '2027-06-12', TODAY, 1, 2)).rejects.toThrow(/Couldn't load/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(loadTripWeather('2027-06-11', '2027-06-12', TODAY, 1, 2)).rejects.toThrow(/connection/);
    expect(store.size).toBe(0);
  });
});
