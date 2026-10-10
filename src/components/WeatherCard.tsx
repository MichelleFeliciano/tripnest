import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly, rows } from '../api/api';
import { getDevice, setTempUnit, setWeatherOn } from '../api/device';
import { geocode } from '../api/geocode';
import { loadTripWeather, type TripWeather } from '../api/weather';
import { useTrip } from '../hooks/contexts';
import { useAction, useToday } from '../hooks/hooks';
import { formatDateShort } from '../lib/time';
import { defaultUnit, describeCode, packingHints, toUnit, WEATHER_MAX_DAYS, type TempUnit, type WeatherKind } from '../lib/weather';
import { ErrorBanner } from './ui';

const KIND_NOTE: Record<WeatherKind, string> = { forecast: 'Forecast', actual: 'What it was', typical: 'Typical' };

/** Weather for the trip's days at one destination. Off until turned on, because it sends coordinates to Open-Meteo. */
export default function WeatherCard() {
  const { data, reload } = useTrip();
  const [on, setOn] = useState(getDevice().weather_on);
  const [unit, setUnit] = useState<TempUnit>(getDevice().temp_unit ?? defaultUnit(navigator.language || 'en-US'));
  const places = data.destinations.filter((d) => d.latitude !== null && d.longitude !== null);
  const [placeId, setPlaceId] = useState<string>('');
  const place = places.find((p) => p.id === placeId) ?? places[0];
  const [weather, setWeather] = useState<TripWeather | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = useAction();

  const today = useToday();
  const request = useRef(0);
  const lat = place?.latitude ?? null;
  const lng = place?.longitude ?? null;
  const { start_date, end_date } = data.trip;

  const load = useCallback(async (force = false) => {
    if (lat === null || lng === null) return;
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    try { const w = await loadTripWeather(start_date, end_date, today, lat, lng, force); if (mine === request.current) setWeather(w); }
    catch (e) { if (mine === request.current) { setWeather(null); setError(friendly(e).message); } }
    finally { if (mine === request.current) setLoading(false); }
  }, [lat, lng, start_date, end_date, today]);

  useEffect(() => { if (on && lat !== null) void load(); }, [on, lat, lng, load]);

  const turn = (v: boolean) => { setWeatherOn(v); setOn(v); if (!v) { setWeather(null); setError(null); } };
  const pickUnit = (u: TempUnit) => { setTempUnit(u); setUnit(u); };
  const findOnMap = async () => {
    const target = data.destinations[0];
    const ok = await find.run(async () => {
      const g = await geocode([target.name, target.region, target.country].filter(Boolean).join(', '));
      if (!g) throw new Error(`Could not find ${target.name} on the map. Open the destination and enter its coordinates instead.`);
      await rows.update('destinations', target.id, { latitude: g.lat, longitude: g.lng });
      return true;
    });
    if (ok) await reload();
  };

  const hints = weather ? packingHints(weather.days) : [];
  const deg = (c: number | null) => { const v = toUnit(c, unit); return v === null ? '–' : `${v}°`; };

  return (
    <section className="card" aria-labelledby="wx-h">
      <div className="row-between">
        <h2 id="wx-h">Weather</h2>
        {on && <div className="row" role="group" aria-label="Temperature unit">
          {(['F', 'C'] as const).map((u) => <button key={u} className={`btn btn-sm ${unit === u ? 'btn-primary' : ''}`} aria-pressed={unit === u} onClick={() => pickUnit(u)}>°{u}</button>)}
        </div>}
      </div>

      {!on ? (
        <>
          <p>See the forecast for your trip days, or what the weather was like at this time last year if the trip is further away.</p>
          <p className="muted">This looks up the weather at your destination's coordinates from Open-Meteo, a free service. Only those coordinates are sent: not your trip, names or anything else. It stays off until you turn it on.</p>
          <button className="btn btn-primary" onClick={() => turn(true)}>Show the weather</button>
        </>
      ) : data.destinations.length === 0 ? (
        <p className="muted">Add a destination below to see its weather.</p>
      ) : !place ? (
        <>
          <p>To show weather, TripNest needs to know where <strong>{data.destinations[0].name}</strong> is.</p>
          <ErrorBanner message={find.error} />
          <button className="btn" onClick={findOnMap} disabled={find.busy}>{find.busy ? 'Looking…' : `Find ${data.destinations[0].name} on the map`}</button>
          <p className="muted">This sends the place name to OpenStreetMap to look up its coordinates, and saves them on the destination.</p>
        </>
      ) : (
        <>
          {places.length > 1 && (
            <div className="field"><label htmlFor="wx-place">Weather for</label>
              <select id="wx-place" value={place.id} onChange={(e) => setPlaceId(e.target.value)}>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
          )}
          <ErrorBanner message={error} />
          {loading && <p className="muted" role="status">Loading the weather…</p>}
          {weather && (
            <>
              <ul className="list">
                {weather.days.map((d) => {
                  const w = describeCode(d.code);
                  const rain = d.precipChance !== null ? `${Math.round(d.precipChance)}% rain` : d.precipMm !== null ? (d.precipMm >= 1 ? `${d.precipMm.toFixed(1)} mm rain` : 'dry') : '';
                  return (
                    <li key={d.date} className="row-between">
                      <span><strong>{formatDateShort(d.date)}</strong> <span className="muted">· {KIND_NOTE[d.kind]}</span></span>
                      <span><span aria-hidden="true">{w.icon} </span>{w.label} · {deg(d.maxC)} / {deg(d.minC)}{rain && <span className="muted"> · {rain}</span>}</span>
                    </li>
                  );
                })}
              </ul>
              {weather.days.some((d) => d.kind === 'typical') && <p className="muted">“Typical” days show the weather on the same date last year: a rough guide, not a forecast. Real forecasts appear about two weeks before the trip.</p>}
              {weather.unavailable.length > 0 && <p className="muted">No weather is available yet for {weather.unavailable.length} of the dates: they are too far ahead.</p>}
              {weather.truncated && <p className="muted">Showing the first {WEATHER_MAX_DAYS} days of the trip.</p>}
              {hints.length > 0 && (
                <div role="note"><strong>Packing ideas</strong><ul>{hints.map((h) => <li key={h}>{h}</li>)}</ul><Link to={`/trips/${data.trip.id}/packing`}>Open packing list →</Link></div>
              )}
            </>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => void load(true)} disabled={loading}>Refresh</button>
            <button className="btn btn-sm btn-ghost" onClick={() => turn(false)}>Turn off weather</button>
          </div>
          <p className="muted">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a>.</p>
        </>
      )}
    </section>
  );
}
