import { useRef, useState, type FormEvent } from 'react';
import { ALLOWED_DOC_TYPES, MAX_DOC_BYTES, documents } from '../../api/api';
import { nameOf } from '../../api/adapters';
import type { DocumentRow } from '../../api/types';
import { useTrip } from '../../hooks/contexts';
import { useAction } from '../../hooks/hooks';
import { Empty, ErrorBanner, Field } from '../../components/ui';

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default function Documents() {
  const { data, me, reload, can } = useTrip();
  const [link, setLink] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const { busy, error, run, setError } = useAction();
  const open = useAction();

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return setError('Choose a file first.');
    const [kind, id] = link.split(':');
    const ok = await run(async () => {
      await documents.upload(data.trip.id, picked, kind === 'item' ? { itinerary_item_id: id } : kind === 'res' ? { reservation_id: id } : {}, me);
      return true;
    });
    if (ok) { setPicked(null); if (fileRef.current) fileRef.current.value = ''; await reload(); }
  };

  // The URL is requested on click, expires in 60 seconds and is never stored or displayed.
  const view = async (d: DocumentRow) => {
    const w = window.open('', '_blank');
    const url = await open.run(() => documents.signedUrl(d.storage_path));
    if (url && w) { w.opener = null; w.location.href = url; } else w?.close();
  };
  const del = async (d: DocumentRow) => {
    if (!window.confirm(`Delete ${d.file_name}?`)) return;
    const ok = await run(async () => { await documents.remove(d); return true; });
    if (ok) await reload();
  };

  const attached = (d: DocumentRow) =>
    d.itinerary_item_id ? `Itinerary: ${data.items.find((i) => i.id === d.itinerary_item_id)?.title ?? ''}` : d.reservation_id ? `Reservation: ${data.reservations.find((r) => r.id === d.reservation_id)?.title ?? ''}` : 'Whole trip';

  return (
    <div>
      <h2>Documents</h2>
      <p className="muted">Stored privately. Only trip members can open them, through short-lived links.</p>
      {can('documents.upload') && (
        <form className="card" onSubmit={upload}>
          <ErrorBanner message={error} />
          <div className="form-grid">
            <Field label="File" hint={`PDF, image or text. Up to ${MAX_DOC_BYTES / 1024 / 1024} MB.`} className="span-2">
              {(id, d) => <input id={id} aria-describedby={d} ref={fileRef} type="file" accept={ALLOWED_DOC_TYPES.join(',')} onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />}
            </Field>
            <Field label="Attach to" className="span-2">
              {(id) => (
                <select id={id} value={link} onChange={(e) => setLink(e.target.value)}>
                  <option value="">Whole trip</option>
                  <optgroup label="Reservations">{data.reservations.map((r) => <option key={r.id} value={`res:${r.id}`}>{r.title}</option>)}</optgroup>
                  <optgroup label="Itinerary items">{data.items.map((i) => <option key={i.id} value={`item:${i.id}`}>{i.local_date} · {i.title}</option>)}</optgroup>
                </select>
              )}
            </Field>
          </div>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        </form>
      )}
      <ErrorBanner message={open.error} />
      {data.documents.length === 0 ? <Empty title="No documents yet">Hotel confirmations, flight itineraries, rental agreements and tickets can live here.</Empty> : (
        <ul className="list card">
          {data.documents.map((d) => (
            <li key={d.id} className="row-between">
              <div><strong>{d.file_name}</strong><div className="muted">{attached(d)} · {size(d.size_bytes)} · added by {nameOf(data, d.uploaded_by)}</div></div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => view(d)} aria-label={`Open ${d.file_name}`}>Open</button>
                {(data.role === 'owner' || (d.uploaded_by === me && can('documents.upload'))) && <button className="btn btn-sm btn-danger" onClick={() => del(d)} aria-label={`Delete ${d.file_name}`}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
