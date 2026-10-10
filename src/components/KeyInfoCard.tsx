import { useState, type FormEvent } from 'react';
import { trips } from '../api/api';
import { useTrip } from '../hooks/contexts';
import { useAction } from '../hooks/hooks';
import { Dialog, ErrorBanner, Field } from './ui';

const MAX = 2000;

/** A short pinned note for the moments you are stressed: flight numbers, hotel address, who to call. Works offline. */
export default function KeyInfoCard() {
  const { data, reload } = useTrip();
  const info = data.trip.key_info ?? '';
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();

  const edit = () => { setText(info); setOpen(true); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => { await trips.update(data.trip.id, { key_info: text }); return true; });
    if (ok) { await reload(); setOpen(false); }
  };

  return (
    <section className="card" aria-labelledby="ki-h">
      <div className="row-between">
        <h2 id="ki-h">Key info</h2>
        <button className="btn btn-sm" onClick={edit}>{info ? 'Edit' : 'Add'}</button>
      </div>
      {info ? <p style={{ whiteSpace: 'pre-wrap' }}>{info}</p> : (
        <p className="muted">Pin what you would want at the airport or at midnight: flight numbers, the hotel's address and phone, an emergency contact, the travel insurance number.</p>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Key info">
        <form onSubmit={save}>
          <ErrorBanner message={error} />
          <Field label="What should be easy to find?" hint={`Don't put passport, ID or card numbers here. ${text.length} / ${MAX}`}>
            {(id, d) => <textarea id={id} aria-describedby={d} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX} rows={8} placeholder={'Flight: WN 1234, gate B7\nHotel: Hotel El Convento, 100 Calle del Cristo, +1 787 555 0199\nEmergency: Mom +1 512 555 0123'} />}
          </Field>
          <div className="row"><button className="btn btn-primary" disabled={busy}>Save</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Dialog>
    </section>
  );
}
