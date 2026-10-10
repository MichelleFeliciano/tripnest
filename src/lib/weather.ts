/**
 * Weather for trip days, from Open-Meteo (free, no account or key). Pure functions only: which service answers
 * which date, URL building, response parsing, labels, units and packing hints. Network access lives in src/api/weather.ts.
 *
 *  - dates from 92 days ago to 15 days ahead  -> the forecast service (recent days are what actually happened)
 *  - older dates                              -> the historical archive (what actually happened)
 *  - dates further ahead                      -> "typical": what the weather was on the same date a year earlier
 */
import { addDays } from './tasks';

export const WEATHER_MAX_DAYS = 16;
export const FORECAST_AHEAD_DAYS = 15;
export const FORECAST_BACK_DAYS = 92;
/** The archive trails real time by a few days; "typical" needs last year's date to be safely inside it. */
export const ARCHIVE_LAG_DAYS = 7;

export type WeatherKind = 'forecast' | 'actual' | 'typical';
export interface WeatherDay {
  date: string; // the trip day this is shown for
  kind: WeatherKind;
  /** For "typical", the date a year earlier the numbers come from. */
  basedOn: string | null;
  code: number | null;
  maxC: number | null;
  minC: number | null;
  precipMm: number | null;
  precipChance: number | null; // percent, forecasts only
}

const dayNum = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
export const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);

/** The same calendar date one year earlier (29 Feb becomes 28 Feb). */
export function yearBefore(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const leapDay = m === 2 && d === 29;
  return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(leapDay ? 28 : d).padStart(2, '0')}`;
}

export interface WeatherRequest {
  kind: WeatherKind;
  /** Dates to fetch (inclusive range). For "typical" these are last year's dates. */
  start: string;
  end: string;
  /** trip date -> date fetched, for "typical" (identity otherwise) */
  dates: { trip: string; source: string }[];
}

/** Which dates of the trip need which service. Trip dates beyond what can be answered are returned as `unavailable`. */
export function planWeather(tripStart: string, tripEnd: string, today: string): { requests: WeatherRequest[]; unavailable: string[]; truncated: boolean } {
  const all: string[] = [];
  for (let d = tripStart; d <= tripEnd && all.length < 400; d = addDays(d, 1)) all.push(d);
  const shown = all.slice(0, WEATHER_MAX_DAYS);
  const groups: Record<WeatherKind, { trip: string; source: string }[]> = { forecast: [], actual: [], typical: [] };
  const unavailable: string[] = [];
  for (const d of shown) {
    const ahead = daysBetween(today, d);
    if (ahead > FORECAST_AHEAD_DAYS) {
      const prior = yearBefore(d);
      if (daysBetween(prior, today) >= ARCHIVE_LAG_DAYS) groups.typical.push({ trip: d, source: prior });
      else unavailable.push(d);
    } else if (ahead >= -FORECAST_BACK_DAYS) groups.forecast.push({ trip: d, source: d });
    else groups.actual.push({ trip: d, source: d });
  }
  const requests = (Object.keys(groups) as WeatherKind[])
    .filter((k) => groups[k].length > 0)
    .map((kind): WeatherRequest => {
      const sources = groups[kind].map((x) => x.source).sort();
      return { kind, start: sources[0], end: sources[sources.length - 1], dates: groups[kind] };
    });
  return { requests, unavailable, truncated: all.length > shown.length };
}

const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum';
export function weatherUrl(req: WeatherRequest, lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates');
  const host = req.kind === 'forecast' ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const daily = req.kind === 'forecast' ? `${DAILY},precipitation_probability_max` : DAILY;
  return `${host}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&daily=${daily}&timezone=auto&start_date=${req.start}&end_date=${req.end}`;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Validates an Open-Meteo reply and maps it onto trip dates. Anything malformed becomes an error, never silent bad data. */
export function parseWeather(json: unknown, req: WeatherRequest): WeatherDay[] {
  const daily = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const time = daily?.time;
  if (!daily || !Array.isArray(time) || time.some((t) => typeof t !== 'string')) throw new Error('Unexpected weather response');
  const col = (name: string): unknown[] => {
    const v = daily[name];
    if (v === undefined) return time.map(() => null);
    if (!Array.isArray(v) || v.length !== time.length) throw new Error('Unexpected weather response');
    return v;
  };
  const code = col('weather_code'), max = col('temperature_2m_max'), min = col('temperature_2m_min'), rain = col('precipitation_sum'), chance = col('precipitation_probability_max');
  const bySource = new Map<string, number>(time.map((t, i) => [t as string, i]));
  const out: WeatherDay[] = [];
  for (const { trip, source } of req.dates) {
    const i = bySource.get(source);
    if (i === undefined) continue;
    const c = num(code[i]);
    out.push({
      date: trip, kind: req.kind, basedOn: req.kind === 'typical' ? source : null,
      code: c, maxC: num(max[i]), minC: num(min[i]), precipMm: num(rain[i]), precipChance: num(chance[i]),
    });
  }
  return out;
}

/** WMO weather interpretation codes, grouped into the labels people care about. */
export function describeCode(code: number | null): { label: string; icon: string } {
  if (code === null) return { label: 'No data', icon: '·' };
  if (code === 0) return { label: 'Clear', icon: '☀️' };
  if (code === 1) return { label: 'Mostly clear', icon: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '🌦️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '🌨️' };
  if (code >= 95 && code <= 99) return { label: 'Thunderstorms', icon: '⛈️' };
  return { label: 'Mixed', icon: '🌥️' };
}

export type TempUnit = 'F' | 'C';
export const toUnit = (c: number | null, unit: TempUnit): number | null => (c === null ? null : Math.round(unit === 'F' ? (c * 9) / 5 + 32 : c));
/** Fahrenheit for the United States and a few others; Celsius everywhere else. */
export function defaultUnit(locale: string): TempUnit {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  return region && ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'].includes(region) ? 'F' : 'C';
}

const WET_CODE = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
export const isWet = (d: WeatherDay): boolean => (d.precipChance !== null && d.precipChance >= 50) || (d.precipMm !== null && d.precipMm >= 2) || (d.code !== null && WET_CODE(d.code));

/** Short, practical packing suggestions from the days we have. */
export function packingHints(days: WeatherDay[]): string[] {
  const hints: string[] = [];
  if (days.length === 0) return hints;
  const wet = days.filter(isWet).length;
  if (wet > 0) hints.push(`Rain on ${wet} of ${days.length} days: pack a rain jacket or umbrella.`);
  const cold = days.some((d) => d.minC !== null && d.minC < 10);
  if (cold) hints.push('Cool mornings or evenings: bring a warm layer.');
  const hot = days.some((d) => d.maxC !== null && d.maxC >= 28);
  if (hot) hints.push('Hot days: sunscreen, a hat and a refillable water bottle.');
  const snow = days.some((d) => d.code !== null && d.code >= 71 && d.code <= 77);
  if (snow) hints.push('Snow possible: waterproof boots and warm gloves.');
  return hints;
}
