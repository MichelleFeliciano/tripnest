import { useState, type FormEvent } from 'react';
import { rows } from '../api/api';
import { defaultZone } from '../api/adapters';
import { geocode, parseCoord } from '../api/geocode';
import type { ItineraryRow } from '../api/types';
import { useTrip } from '../hooks/contexts';
import { useAction, useDraft } from '../hooks/hooks';
import { COMMON_CURRENCIES, MoneyError, minorToInput, parseMoney } from '../lib/money';
import { ITEM_LABELS, ITEM_TYPES, type ItemType } from '../lib/itinerary';
import { COMMON_TIMEZONES, isValidTimeZone, localDate, localTime, zonedToUtc } from '../lib/time';
import { tripDates } from '../lib/trip';
import { ErrorBanner, Field } from './ui';

interface Form {
  title: string; item_type: ItemType; date: string; start_time: string; end_date: string; end_time: string;
  start_tz: string; end_tz: string; description: string; location_name: string; address: string; lat: string; lng: string;
  notes: string; cost: string; currency: string; confirmation_number: string; website: string; contact: string; destination_id: string;
}

export default function ItemForm({ editing, defaultDate, onDone, onCancel }: { editing: ItineraryRow | null; defaultDate?: string; onDone: () => void; onCancel: () => void }) {
  const { data, reload } = useTrip();
  const { trip } = data;
  const lastTz = defaultZone(data.items);
  const endLocalDate = editing?.end_at && editing.end_tz ? localDate(editing.end_at, editing.end_tz) : '';
  const initial: Form = editing
    ? {
        title: editing.title, item_type: editing.item_type, date: editing.local_date,
        start_time: editing.start_at && editing.start_tz ? localTime(editing.start_at, editing.start_tz) : '',
        // only pre-fill the end date when it is a different day, so changing the start date later cannot leave a stale end date behind
        end_date: endLocalDate && endLocalDate !== editing.local_date ? endLocalDate : '',
        end_time: editing.end_at && editing.end_tz ? localTime(editing.end_at, editing.end_tz) : '',
        start_tz: editing.start_tz ?? lastTz, end_tz: editing.end_tz ?? editing.start_tz ?? lastTz,
        description: editing.description ?? '', location_name: editing.location_name ?? '', address: editing.address ?? '',
        lat: editing.latitude?.toString() ?? '', lng: editing.longitude?.toString() ?? '', notes: editing.notes ?? '',
        cost: editing.cost_cents !== null && editing.currency ? minorToInput(editing.cost_cents, editing.currency) : '',
        currency: editing.currency ?? trip.default_currency, confirmation_number: editing.confirmation_number ?? '',
        website: editing.website ?? '', contact: editing.contact ?? '', destination_id: editing.destination_id ?? '',
      }
    : {
        title: '', item_type: 'activity', date: defaultDate ?? trip.start_date, start_time: '', end_date: '', end_time: '', start_tz: lastTz, end_tz: lastTz,
        description: '', location_name: '', address: '', lat: '', lng: '', notes: '', cost: '', currency: trip.default_currency,
        confirmation_number: '', website: '', contact: '', destination_id: '',
      };
  const [f, set, clear] = useDraft<Form>(`item-${trip.id}-${editing?.id ?? 'new'}`, initial);
  const [errs, setErrs] = useState<string[]>([]);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const dates = tripDates(trip.start_date, trip.end_date);
  // The picker is limited to the trip's days, but never so tightly that an existing item (from before the trip was shortened) cannot be saved.
  const minDate = editing && editing.local_date < dates[0] ? editing.local_date : dates[0];
  const maxDate = editing && editing.local_date > dates[dates.length - 1] ? editing.local_date : dates[dates.length - 1];

  const lookup = async () => {
    setGeoMsg('Looking up…');
    const r = await geocode([f.location_name, f.address].filter(Boolean).join(', '));
    if (r) { set({ lat: r.lat.toFixed(6), lng: r.lng.toFixed(6) }); setGeoMsg('Coordinates filled in.'); }
    else setGeoMsg('Could not find that place. You can enter coordinates manually or skip this.');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems: string[] = [];
    if (!f.title.trim()) problems.push('Title is required');
    if (!f.date) problems.push('Date is required');
    if (f.start_time && !isValidTimeZone(f.start_tz)) problems.push('Start time zone is not valid');
    if (f.end_time && !isValidTimeZone(f.end_tz || f.start_tz)) problems.push('End time zone is not valid');
    if (f.end_time && !f.start_time) problems.push('Add a start time before an end time');
    const lat = parseCoord(f.lat, 90);
    const lng = parseCoord(f.lng, 180);
    if (lat === 'invalid' || lng === 'invalid') problems.push('Coordinates must be numbers (latitude −90 to 90, longitude −180 to 180)');
    if ((lat === null) !== (lng === null)) problems.push('Enter both latitude and longitude, or neither');
    let cost: number | null = null;
    if (f.cost.trim()) {
      try { cost = parseMoney(f.cost, f.currency); } catch (x) { problems.push((x as MoneyError).message); }
    }
    if (f.website && !/^https?:\/\//i.test(f.website)) problems.push('Website must start with http:// or https://');
    let startAt: Date | null = null;
    let endAt: Date | null = null;
    if (!problems.length) {
      if (f.start_time) startAt = zonedToUtc(f.date, f.start_time, f.start_tz);
      if (f.end_time && startAt) {
        endAt = zonedToUtc(f.end_date || f.date, f.end_time, f.end_tz || f.start_tz);
        if (endAt < startAt) problems.push('The end must be after the start (check the dates and time zones)');
      }
    }
    setErrs(problems);
    if (problems.length) return;
    const payload = {
      trip_id: trip.id, title: f.title, item_type: f.item_type, local_date: f.date,
      start_at: startAt?.toISOString() ?? null, start_tz: startAt ? f.start_tz : null,
      end_at: endAt?.toISOString() ?? null, end_tz: endAt ? f.end_tz || f.start_tz : null,
      description: f.description, location_name: f.location_name, address: f.address,
      latitude: lat === 'invalid' ? null : lat, longitude: lng === 'invalid' ? null : lng, notes: f.notes,
      cost_cents: cost, currency: cost !== null ? f.currency : null, confirmation_number: f.confirmation_number,
      website: f.website, contact: f.contact, destination_id: f.destination_id || null,
    };
    const ok = await run(async () => {
      if (editing) await rows.update('itinerary_items', editing.id, payload);
      else await rows.insert('itinerary_items', payload);
      return true;
    });
    if (ok) { clear(); await reload(); onDone(); }
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Delete "${editing.title}"? This can't be undone.`)) return;
    const ok = await run(async () => { await rows.remove('itinerary_items', editing.id); return true; });
    if (ok) { clear(); await reload(); onDone(); }
  };
  return (
    <form onSubmit={submit}>
      <ErrorBanner message={error} />
      {errs.length > 0 && <div className="alert alert-error" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      <fieldset style={{ border: 0, padding: 0 }}>
        <div className="form-grid">
          <Field label="Title *" className="span-2">{(id) => <input id={id} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} required />}</Field>
          <Field label="Type">{(id) => <select id={id} value={f.item_type} onChange={(e) => set({ item_type: e.target.value as ItemType })}>{ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_LABELS[t]}</option>)}</select>}</Field>
          <Field label="Date *" hint="Local date at the place">{(id, d) => <input id={id} aria-describedby={d} type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} required min={minDate} max={maxDate} />}</Field>
          <Field label="Start time" hint="Leave blank for an all-day item">{(id, d) => <input id={id} aria-describedby={d} type="time" value={f.start_time} onChange={(e) => set({ start_time: e.target.value })} />}</Field>
          <Field label="Start time zone">{(id) => (<><input id={id} list="tz-opts" value={f.start_tz} onChange={(e) => set({ start_tz: e.target.value, end_tz: f.end_tz === f.start_tz ? e.target.value : f.end_tz })} /><datalist id="tz-opts">{COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist></>)}</Field>
          <Field label="End time">{(id) => <input id={id} type="time" value={f.end_time} onChange={(e) => set({ end_time: e.target.value })} />}</Field>
          <Field label="End date" hint="Only if different (overnight, long flights)">{(id, d) => <input id={id} aria-describedby={d} type="date" value={f.end_date} min={f.date} onChange={(e) => set({ end_date: e.target.value })} />}</Field>
          <Field label="End time zone" hint="A flight can land in another zone" className="span-2">{(id, d) => <input id={id} aria-describedby={d} list="tz-opts" value={f.end_tz} onChange={(e) => set({ end_tz: e.target.value })} />}</Field>
          <Field label="Destination">{(id) => <select id={id} value={f.destination_id} onChange={(e) => set({ destination_id: e.target.value })}><option value="">None</option>{data.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}</Field>
          <Field label="Location name">{(id) => <input id={id} value={f.location_name} onChange={(e) => set({ location_name: e.target.value })} maxLength={200} />}</Field>
          <Field label="Address" className="span-2">{(id) => <input id={id} value={f.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} autoComplete="street-address" />}</Field>
          <Field label="Latitude">{(id) => <input id={id} inputMode="decimal" value={f.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="18.4655" />}</Field>
          <Field label="Longitude">{(id) => <input id={id} inputMode="decimal" value={f.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="-66.1057" />}</Field>
          <div className="span-2 row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-sm" onClick={lookup}>Find coordinates (optional)</button>
            {geoMsg && <span className="muted" role="status">{geoMsg}</span>}
          </div>
          <Field label="Cost">{(id) => <input id={id} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="0.00" />}</Field>
          <Field label="Currency">{(id) => <select id={id} value={f.currency} onChange={(e) => set({ currency: e.target.value })}>{[...new Set([f.currency, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
          <Field label="Confirmation number">{(id) => <input id={id} value={f.confirmation_number} onChange={(e) => set({ confirmation_number: e.target.value })} maxLength={100} />}</Field>
          <Field label="Website">{(id) => <input id={id} type="url" value={f.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://…" />}</Field>
          <Field label="Contact (phone / email)" className="span-2">{(id) => <input id={id} value={f.contact} onChange={(e) => set({ contact: e.target.value })} maxLength={300} />}</Field>
          <Field label="Description" className="span-2">{(id) => <textarea id={id} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} />}</Field>
          <Field label="Notes" className="span-2">{(id) => <textarea id={id} value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={5000} />}</Field>
        </div>
      </fieldset>
      <div className="row-between">
        <div className="row">
          {<button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add to itinerary'}</button>}
          <button type="button" className="btn" onClick={() => { clear(); onCancel(); }}>Cancel</button>
        </div>
        {editing && <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>Delete</button>}
      </div>
    </form>
  );
}
