import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { trips } from '../api/api';
import { getSettings, saveSettings } from '../api/settings';
import { COMMON_CURRENCIES } from '../lib/money';
import { TRIP_STATUSES, STATUS_LABELS, tripDuration, validateTrip, type TripStatus } from '../lib/trip';
import { ErrorBanner, Field } from '../components/ui';
import { useAction, useDraft } from '../hooks/hooks';

export default function NewTripPage() {
  const nav = useNavigate();
  const [f, set, clear] = useDraft('new-trip', {
    name: '', description: '', start_date: '', end_date: '', cover_image_url: '', primary_destination: '', extra: '', status: 'planning' as TripStatus,
    notes: '', default_currency: 'USD', me: getSettings().display_name, others: '',
  });
  const [errs, setErrs] = useState<string[]>([]);
  const { busy, error, run } = useAction();

  const dur = f.start_date && f.end_date && f.end_date >= f.start_date ? tripDuration(f.start_date, f.end_date) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = validateTrip({ name: f.name, startDate: f.start_date, endDate: f.end_date });
    if (!f.me.trim()) problems.push('Add your name');
    if (f.cover_image_url && !/^https:\/\//i.test(f.cover_image_url)) problems.push('Cover image must be an https:// link');
    setErrs(problems);
    if (problems.length) return;
    const split = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const { extra, others, me, ...trip } = f;
    const created = await run(() => trips.create(trip, [me, ...split(others)], split(extra)));
    if (created) {
      const s = getSettings();
      if (!s.display_name) saveSettings({ ...s, display_name: me });
      clear();
      nav(`/trips/${created.id}`);
    }
  };

  return (
    <main className="container">
      <h1>Create a trip</h1>
      <form className="card" onSubmit={submit}>
        <ErrorBanner message={error} />
        {errs.length > 0 && <div className="alert alert-error" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        <div className="form-grid">
          <Field label="Trip name *" className="span-2">{(id) => <input id={id} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} required placeholder="Puerto Rico Vacation" />}</Field>
          <Field label="Start date *">{(id) => <input id={id} type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value, end_date: f.end_date && f.end_date < e.target.value ? e.target.value : f.end_date })} required />}</Field>
          <Field label="End date *" hint={dur ? `${dur.days} days · ${dur.nights} nights` : undefined}>{(id, d) => <input id={id} aria-describedby={d} type="date" min={f.start_date || undefined} value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} required />}</Field>
          <Field label="Your name *" hint="You'll be the first traveler">{(id, d) => <input id={id} aria-describedby={d} value={f.me} onChange={(e) => set({ me: e.target.value })} maxLength={80} required autoComplete="name" />}</Field>
          <Field label="Who else is going?" hint="Separate names with commas. You can add more later.">{(id, d) => <input id={id} aria-describedby={d} value={f.others} onChange={(e) => set({ others: e.target.value })} placeholder="Jon, Mom" />}</Field>
          <Field label="Primary destination">{(id) => <input id={id} value={f.primary_destination} onChange={(e) => set({ primary_destination: e.target.value })} placeholder="San Juan" maxLength={200} />}</Field>
          <Field label="Additional destinations" hint="Separate with commas">{(id, d) => <input id={id} aria-describedby={d} value={f.extra} onChange={(e) => set({ extra: e.target.value })} placeholder="Ponce, Rincón" />}</Field>
          <Field label="Status">{(id) => <select id={id} value={f.status} onChange={(e) => set({ status: e.target.value as TripStatus })}>{TRIP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>}</Field>
          <Field label="Default currency">{(id) => <select id={id} value={f.default_currency} onChange={(e) => set({ default_currency: e.target.value })}>{COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}</Field>
          <Field label="Cover image link" hint="Optional, https:// only" className="span-2">{(id, d) => <input id={id} aria-describedby={d} type="url" value={f.cover_image_url} onChange={(e) => set({ cover_image_url: e.target.value })} placeholder="https://…" />}</Field>
          <Field label="Description" className="span-2">{(id) => <textarea id={id} value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={5000} />}</Field>
          <Field label="Notes" className="span-2">{(id) => <textarea id={id} value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={20000} />}</Field>
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create trip'}</button>
          <button type="button" className="btn" onClick={() => nav('/trips')}>Cancel</button>
        </div>
      </form>
    </main>
  );
}
