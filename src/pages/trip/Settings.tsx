import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { trips } from '../../api/api';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { COMMON_CURRENCIES } from '../../lib/money';
import { STATUS_LABELS, TRIP_STATUSES, tripDuration, validateTrip, type TripStatus } from '../../lib/trip';
import { Alert, ErrorBanner, Field } from '../../components/ui';

export default function Settings() {
  const { data, reload } = useTrip();
  const nav = useNavigate();
  const t = data.trip;
  const [f, setF] = useState({
    name: t.name, description: t.description ?? '', start_date: t.start_date, end_date: t.end_date, cover_image_url: t.cover_image_url ?? '',
    primary_destination: t.primary_destination ?? '', status: t.status as TripStatus, notes: t.notes ?? '', default_currency: t.default_currency, budget_near_pct: String(t.budget_near_pct),
  });
  useEffect(() => {
    setF({ name: t.name, description: t.description ?? '', start_date: t.start_date, end_date: t.end_date, cover_image_url: t.cover_image_url ?? '', primary_destination: t.primary_destination ?? '', status: t.status as TripStatus, notes: t.notes ?? '', default_currency: t.default_currency, budget_near_pct: String(t.budget_near_pct) });
  }, [t]);
  const [errs, setErrs] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const dur = f.end_date >= f.start_date ? tripDuration(f.start_date, f.end_date) : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const p = validateTrip({ name: f.name, startDate: f.start_date, endDate: f.end_date });
    const near = Number(f.budget_near_pct);
    if (!Number.isInteger(near) || near < 1 || near > 100) p.push('Budget warning threshold must be a whole number from 1 to 100');
    if (f.cover_image_url && !/^https:\/\//i.test(f.cover_image_url)) p.push('Cover image must be an https:// link');
    setErrs(p);
    if (p.length) return;
    const ok = await run(async () => { await trips.update(t.id, { ...f, budget_near_pct: near }); return true; });
    if (ok) { await reload(); setSaved(true); }
  };
  const archive = async () => {
    const ok = await run(async () => { await trips.update(t.id, { status: t.status === 'archived' ? 'planning' : 'archived' }); return true; });
    if (ok) await reload();
  };
  const del = async () => {
    if (window.prompt(`This permanently deletes the trip and everything in it, including documents, from this device.\nTip: download a backup first (Profile page) if you might want it back.\nType the trip name to confirm:`) !== t.name) return;
    const ok = await run(async () => { await trips.remove(t.id); return true; });
    if (ok) nav('/trips', { replace: true });
  };

  return (
    <div>
      <h2>Trip settings</h2>
      <form className="card" onSubmit={save}>
        <ErrorBanner message={error} />
        {saved && <Alert kind="success">Saved.</Alert>}
        {errs.length > 0 && <div className="alert alert-error" role="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{errs.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        <div className="form-grid">
          <Field label="Trip name *" className="span-2">{(id) => <input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} required />}</Field>
          <Field label="Start date">{(id) => <input id={id} type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} required />}</Field>
          <Field label="End date" hint={dur ? `${dur.days} days · ${dur.nights} nights` : 'End date cannot be before the start'}>{(id, d) => <input id={id} aria-describedby={d} type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} required />}</Field>
          <Field label="Primary destination">{(id) => <input id={id} value={f.primary_destination} onChange={(e) => setF({ ...f, primary_destination: e.target.value })} />}</Field>
          <Field label="Status">{(id) => <select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TripStatus })}>{TRIP_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>}</Field>
          <Field label="Default currency">{(id) => <select id={id} value={f.default_currency} onChange={(e) => setF({ ...f, default_currency: e.target.value })}>{[...new Set([f.default_currency, ...COMMON_CURRENCIES])].map((c) => <option key={c}>{c}</option>)}</select>}</Field>
          <Field label="Budget “near” warning at (%)" hint="Show a gentle heads-up when a budget reaches this percent">{(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" value={f.budget_near_pct} onChange={(e) => setF({ ...f, budget_near_pct: e.target.value })} />}</Field>
          <Field label="Cover image link" className="span-2">{(id) => <input id={id} type="url" value={f.cover_image_url} onChange={(e) => setF({ ...f, cover_image_url: e.target.value })} placeholder="https://…" />}</Field>
          <Field label="Description" className="span-2">{(id) => <textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={5000} />}</Field>
          <Field label="Notes" className="span-2">{(id) => <textarea id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={20000} />}</Field>
        </div>
        <button className="btn btn-primary" disabled={busy}>Save settings</button>
      </form>
      <section className="card">
        <h3>Archive or delete</h3>
        <div className="row">
          <button className="btn" onClick={archive} disabled={busy}>{t.status === 'archived' ? 'Restore from archive' : 'Archive trip'}</button>
          <button className="btn btn-danger" onClick={del} disabled={busy}>Delete trip…</button>
        </div>
        <p className="muted">Archiving hides the trip from your main list but keeps everything. Deleting is permanent.</p>
      </section>
    </div>
  );
}
