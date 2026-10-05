import { Link } from 'react-router-dom';
import { useTrip } from '../../hooks/contexts';
import { Empty } from '../../components/ui';
import { KIND_LABELS, KIND_ICONS, KIND_ORDER, ReservationCard } from './Reservations';

/** Quick-access view of everything a traveler needs at a counter: hotel, flights, confirmation numbers, contacts. */
export default function Details() {
  const { data } = useTrip();
  const withConf = data.reservations.filter((r) => r.confirmation_number);
  const noteTrip = data.notes.filter((n) => n.scope === 'trip');
  return (
    <div>
      <h2>Travel details</h2>
      <p className="muted">Everything important in one place. Add or edit items under <Link to="../reservations">Reservations</Link>.</p>

      {withConf.length > 0 && (
        <section className="card" aria-labelledby="conf-h">
          <h3 id="conf-h">All confirmation numbers</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Booking</th><th scope="col">Type</th><th scope="col">Confirmation</th></tr></thead>
              <tbody>{withConf.map((r) => <tr key={r.id}><td>{r.title}</td><td>{KIND_LABELS[r.kind]}</td><td className="conf">{r.confirmation_number}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {data.reservations.length === 0 && <Empty title="No travel details yet">Add your flights, hotel, rental car and emergency contacts as reservations (use “Other / info” for contacts and check-in instructions).</Empty>}
      {KIND_ORDER.map((k) => {
        const list = data.reservations.filter((r) => r.kind === k);
        if (!list.length) return null;
        return (
          <section key={k} aria-labelledby={`k-${k}`}>
            <h3 id={`k-${k}`}><span aria-hidden="true">{KIND_ICONS[k]} </span>{k === 'other' ? 'Contacts & other info' : `${KIND_LABELS[k]}s`}</h3>
            {list.map((r) => <ReservationCard key={r.id} r={r} />)}
          </section>
        );
      })}
      {data.trip.notes && <section className="card"><h3>Trip notes</h3><p style={{ whiteSpace: 'pre-wrap' }}>{data.trip.notes}</p></section>}
      {noteTrip.length > 0 && <section className="card"><h3>Trip-level notes</h3>{noteTrip.map((n) => <p key={n.id} style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>)}</section>}
    </div>
  );
}
