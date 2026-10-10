import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast';
import type { Deleted } from '../../api/api';
import { useSearchParams } from 'react-router-dom';
import { rows } from '../../api/api';
import { defaultZone } from '../../api/adapters';
import type { Reservation, ReservationKind } from '../../api/types';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { COMMON_TIMEZONES, isValidTimeZone, localDate, localTime, formatTime, zoneAbbr, formatDateShort, zonedToUtc } from '../../lib/time';
import { Fragment } from "react";
import { Dialog, Empty, ErrorBanner, Field, SafeLink } from '../../components/ui';

export const KIND_LABELS: Record<ReservationKind, string> = {
  flight: 'Flight', hotel: 'Hotel', restaurant: 'Restaurant', activity: 'Activity', car_rental: 'Rental car', other: 'Other / info',
};
export const KIND_ICONS: Record<ReservationKind, string> = { flight: '✈️', hotel: '🏨', restaurant: '🍽️', activity: '🎟️', car_rental: '🚗', other: '📌' };
export const KIND_ORDER: ReservationKind[] = ['flight', 'hotel', 'car_rental', 'restaurant', 'activity', 'other'];

const DETAIL_FIELDS: Record<ReservationKind, [string, string][]> = {
  flight: [['airline', 'Airline'], ['flight_number', 'Flight number'], ['departure_airport', 'Departure airport'], ['arrival_airport', 'Arrival airport'], ['seat', 'Seat'], ['terminal', 'Terminal'], ['gate', 'Gate']],
  hotel: [['room', 'Room information'], ['check_in_instructions', 'Check-in instructions']],
  restaurant: [['party_size', 'Party size']],
  activity: [['contact_name', 'Contact person']],
  car_rental: [['pickup_location', 'Pick-up location'], ['dropoff_location', 'Drop-off location'], ['vehicle', 'Vehicle']],
  other: [],
};
const WHEN_LABELS: Record<ReservationKind, [string, string]> = {
  flight: ['Departure', 'Arrival'], hotel: ['Check-in', 'Check-out'], restaurant: ['Date / time', 'Ends'], activity: ['Starts', 'Ends'], car_rental: ['Pick-up', 'Drop-off'], other: ['Starts', 'Ends'],
};

export function whenText(r: Reservation): string | null {
  if (!r.starts_at || !r.starts_tz) return null;
  const s = `${formatDateShort(localDate(r.starts_at, r.starts_tz))}, ${formatTime(r.starts_at, r.starts_tz)} ${zoneAbbr(r.starts_at, r.starts_tz)}`;
  if (!r.ends_at || !r.ends_tz) return s;
  return `${s} → ${formatDateShort(localDate(r.ends_at, r.ends_tz))}, ${formatTime(r.ends_at, r.ends_tz)} ${zoneAbbr(r.ends_at, r.ends_tz)}`;
}

interface F {
  kind: ReservationKind; title: string; provider: string; confirmation_number: string;
  s_date: string; s_time: string; s_tz: string; e_date: string; e_time: string; e_tz: string;
  website: string; phone: string; address: string; notes: string; itinerary_item_id: string; details: Record<string, string>;
}

export function ReservationCard({ r, onEdit }: { r: Reservation; onEdit?: (r: Reservation) => void }) {
  const when = whenText(r);
  return (
    <div className="card">
      <div className="row-between">
        <h3 style={{ margin: 0 }}><span aria-hidden="true">{KIND_ICONS[r.kind]} </span>{r.title} <span className="muted">({KIND_LABELS[r.kind]})</span></h3>
        {onEdit && <button className="btn btn-sm" onClick={() => onEdit(r)} aria-label={`Edit ${r.title}`}>Edit</button>}
      </div>
      {r.confirmation_number && <p>Confirmation: <span className="conf">{r.confirmation_number}</span></p>}
      <dl className="kv">
        {r.provider && <><dt>Provider</dt><dd>{r.provider}</dd></>}
        {when && <><dt>When</dt><dd>{when}</dd></>}
        {r.address && <><dt>Address</dt><dd>{r.address}</dd></>}
        {r.phone && <><dt>Phone</dt><dd><a href={`tel:${r.phone.replace(/[^\d+]/g, '')}`}>{r.phone}</a></dd></>}
        {r.website && <><dt>Website</dt><dd><SafeLink href={r.website}>{r.website}</SafeLink></dd></>}
        {DETAIL_FIELDS[r.kind].filter(([k]) => r.details?.[k]).map(([k, label]) => <Fragment key={k}><dt>{label}</dt><dd>{r.details[k]}</dd></Fragment>)}
      </dl>
      {r.notes && <p>{r.notes}</p>}
    </div>
  );
}

export default function Reservations() {
  const { data, reload } = useTrip();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tz0 = defaultZone(data.items);
  const blank = (): F => ({ kind: 'hotel', title: '', provider: '', confirmation_number: '', s_date: '', s_time: '', s_tz: tz0, e_date: '', e_time: '', e_tz: tz0, website: '', phone: '', address: '', notes: '', itinerary_item_id: '', details: {} });
  const [editing, setEditing] = useState<Reservation | 'new' | null>(sp.get('new') === '1' ? 'new' : null);
  const [f, setF] = useState<F>(blank);
  const [errs, setErrs] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  const open = (r: Reservation | 'new') => {
    setErrs([]);
    setEditing(r);
    if (r === 'new') return setF(blank());
    setF({
      kind: r.kind, title: r.title, provider: r.provider ?? '', confirmation_number: r.confirmation_number ?? '',
      s_date: r.starts_at && r.starts_tz ? localDate(r.starts_at, r.starts_tz) : '', s_time: r.starts_at && r.starts_tz ? localTime(r.starts_at, r.starts_tz) : '', s_tz: r.starts_tz ?? tz0,
      e_date: r.ends_at && r.ends_tz ? localDate(r.ends_at, r.ends_tz) : '', e_time: r.ends_at && r.ends_tz ? localTime(r.ends_at, r.ends_tz) : '', e_tz: r.ends_tz ?? r.starts_tz ?? tz0,
      website: r.website ?? '', phone: r.phone ?? '', address: r.address ?? '', notes: r.notes ?? '', itinerary_item_id: r.itinerary_item_id ?? '', details: r.details ?? {},
    });
  };
  const close = () => { setEditing(null); setSp((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true }); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p: string[] = [];
    if (!f.title.trim()) p.push('Name is required');
    if (f.website && !/^https?:\/\//i.test(f.website)) p.push('Website must start with http:// or https://');
    if (f.s_date && !isValidTimeZone(f.s_tz)) p.push('Start time zone is not valid');
    if (f.e_date && !isValidTimeZone(f.e_tz)) p.push('End time zone is not valid');
    const starts = f.s_date && !p.length ? zonedToUtc(f.s_date, f.s_time || '00:00', f.s_tz) : null;
    const ends = f.e_date && !p.length ? zonedToUtc(f.e_date, f.e_time || '00:00', f.e_tz) : null;
    if (starts && ends && ends < starts) p.push('The end cannot be before the start');
    setErrs(p);
    if (p.length) return;
    const details = Object.fromEntries(Object.entries(f.details).filter(([k, v]) => v.trim() && DETAIL_FIELDS[f.kind].some(([dk]) => dk === k)).map(([k, v]) => [k, v.trim()]));
    const payload = {
      trip_id: data.trip.id, kind: f.kind, title: f.title, provider: f.provider, confirmation_number: f.confirmation_number,
      starts_at: starts?.toISOString() ?? null, starts_tz: starts ? f.s_tz : null, ends_at: ends?.toISOString() ?? null, ends_tz: ends ? f.e_tz : null,
      website: f.website, phone: f.phone, address: f.address, notes: f.notes, itinerary_item_id: f.itinerary_item_id || null, details,
    };
    const ok = await run(async () => {
      if (editing === 'new') await rows.insert('reservations', payload);
      else if (editing) await rows.update('reservations', editing.id, payload);
      return true;
    });
    if (ok) { await reload(); close(); }
  };
  const remove = async () => {
    if (!editing || editing === 'new' || !window.confirm(`Delete "${editing.title}"?`)) return;
    let gone: Deleted | undefined;
    const ok = await run(async () => { gone = await rows.remove('reservations', editing.id); return true; });
    if (ok) toast.deleted(gone);
    if (ok) { await reload(); close(); }
  };

  const [w1, w2] = WHEN_LABELS[f.kind];
  const sorted = [...data.reservations].sort((a, b) => (a.starts_at ?? '9').localeCompare(b.starts_at ?? '9'));

  return (
    <div>
      <div className="row-between"><h2>Reservations</h2>{<button className="btn btn-primary" onClick={() => open('new')}>+ Add reservation</button>}</div>
      {sorted.length === 0 ? <Empty title="No reservations yet">Add flights, hotels, restaurants and activities with their confirmation numbers.</Empty> : sorted.map((r) => <ReservationCard key={r.id} r={r} onEdit={open} />)}

      <Dialog open={editing !== null} onClose={close} title={editing === 'new' ? 'Add reservation' : 'Edit reservation'}>
        <form onSubmit={submit}>
          <ErrorBanner message={error} />
          {errs.length > 0 && <div className="alert alert-error" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <div className="form-grid">
            <Field label="Type">{(id) => <select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ReservationKind })}>{KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select>}</Field>
            <Field label="Name *" hint={f.kind === 'other' ? 'e.g. Emergency contact, Check-in instructions' : undefined}>{(id, d) => <input id={id} aria-describedby={d} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} />}</Field>
            <Field label={f.kind === 'flight' ? 'Airline / booked with' : 'Provider / company'}>{(id) => <input id={id} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} maxLength={200} />}</Field>
            <Field label="Confirmation number">{(id) => <input id={id} value={f.confirmation_number} onChange={(e) => setF({ ...f, confirmation_number: e.target.value })} maxLength={100} autoCapitalize="characters" />}</Field>
            <Field label={`${w1} date`}>{(id) => <input id={id} type="date" value={f.s_date} onChange={(e) => setF({ ...f, s_date: e.target.value })} />}</Field>
            <Field label={`${w1} time`} hint="Optional">{(id, d) => <input id={id} aria-describedby={d} type="time" value={f.s_time} onChange={(e) => setF({ ...f, s_time: e.target.value })} />}</Field>
            <Field label={`${w1} time zone`} className="span-2">{(id) => (<><input id={id} list="rtz" value={f.s_tz} onChange={(e) => setF({ ...f, s_tz: e.target.value, e_tz: f.e_tz === f.s_tz ? e.target.value : f.e_tz })} /><datalist id="rtz">{COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist></>)}</Field>
            <Field label={`${w2} date`}>{(id) => <input id={id} type="date" min={f.s_date || undefined} value={f.e_date} onChange={(e) => setF({ ...f, e_date: e.target.value })} />}</Field>
            <Field label={`${w2} time`}>{(id) => <input id={id} type="time" value={f.e_time} onChange={(e) => setF({ ...f, e_time: e.target.value })} />}</Field>
            <Field label={`${w2} time zone`} className="span-2">{(id) => <input id={id} list="rtz" value={f.e_tz} onChange={(e) => setF({ ...f, e_tz: e.target.value })} />}</Field>
            {DETAIL_FIELDS[f.kind].map(([k, label]) => (
              <Field key={k} label={label}>{(id) => <input id={id} value={f.details[k] ?? ''} onChange={(e) => setF({ ...f, details: { ...f.details, [k]: e.target.value } })} maxLength={300} />}</Field>
            ))}
            <Field label="Address" className="span-2">{(id) => <input id={id} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={300} />}</Field>
            <Field label="Phone">{(id) => <input id={id} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={60} />}</Field>
            <Field label="Booking website">{(id) => <input id={id} type="url" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" />}</Field>
            <Field label="Linked itinerary item" className="span-2">{(id) => <select id={id} value={f.itinerary_item_id} onChange={(e) => setF({ ...f, itinerary_item_id: e.target.value })}><option value="">None</option>{[...data.items].sort((a, b) => a.local_date.localeCompare(b.local_date)).map((i) => <option key={i.id} value={i.id}>{formatDateShort(i.local_date)} · {i.title}</option>)}</select>}</Field>
            <Field label="Notes" className="span-2">{(id) => <textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={5000} />}</Field>
          </div>
          <div className="row-between">
            <div className="row"><button className="btn btn-primary" disabled={busy}>Save</button><button type="button" className="btn" onClick={close}>Cancel</button></div>
            {editing && editing !== 'new' && <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
