import { useMemo } from 'react';
import { useTrip } from '../../hooks/contexts';
import { expenseLike, icsItem, itemLike, nameOf, packingLike, settlementLike } from '../../api/adapters';
import { buildIcs } from '../../lib/ics';
import { groupByDay } from '../../lib/itinerary';
import { computeNetBalances, suggestSettlements, totalsByCurrency, NO_CONVERSION_NOTICE } from '../../lib/balances';
import { formatMoney } from '../../lib/money';
import { packingProgress, visibleItems } from '../../lib/packing';
import { dayIndex, formatDateRange, tripDuration } from '../../lib/trip';
import { formatDateLong } from '../../lib/time';
import { download } from '../../components/ui';
import ItemRow from '../../components/ItemRow';
import { KIND_LABELS, ReservationCard } from './Reservations';

/** On screen: export options. When printed (or saved as PDF from the print dialog): a clean trip booklet. */
export default function Export() {
  const { data, me } = useTrip();
  const { trip } = data;
  const { days, nights } = tripDuration(trip.start_date, trip.end_date);
  const byDay = useMemo(() => groupByDay(data.items.map(itemLike)), [data.items]);
  const net = computeNetBalances(data.expenses.map(expenseLike), data.settlements.map(settlementLike));
  const transfers = suggestSettlements(net);
  const totals = totalsByCurrency(data.expenses.map((e) => ({ currency: e.currency, amountCents: e.amount_cents })));
  const mine = visibleItems(data.packingItems.map(packingLike), me);
  const shared = mine.filter((i) => i.isShared);
  const rowOf = (id: string) => data.items.find((i) => i.id === id)!;

  const ics = () => download(`${trip.name.replace(/[^\w]+/g, '-').toLowerCase() || 'trip'}.ics`, buildIcs(trip.name, data.items.map(icsItem)), 'text/calendar;charset=utf-8');

  return (
    <div>
      <section className="card no-print">
        <h2>Export</h2>
        <p className="muted">Print the booklet below, or choose “Save as PDF” in your browser's print dialog.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
          <button className="btn" onClick={ics} disabled={data.items.length === 0}>Download calendar (.ics)</button>
        </div>
        <p className="muted">The calendar file works with Apple, Google and Outlook calendars. Times are exact moments, so they show correctly in whichever zone your calendar uses.</p>
      </section>

      <article aria-label="Printable trip booklet">
        <header>
          <h1>{trip.name}</h1>
          <p>{formatDateRange(trip.start_date, trip.end_date)} · {days} days · {nights} nights{trip.primary_destination ? ` · ${trip.primary_destination}` : ''}</p>
          <p>Travelers: {data.members.map((m) => nameOf(data, m.user_id)).join(', ')}</p>
          {trip.description && <p>{trip.description}</p>}
        </header>

        {data.destinations.length > 0 && <section className="card"><h2>Destinations</h2><ul>{data.destinations.map((d) => <li key={d.id}>{d.name}{[d.region, d.country].filter(Boolean).length > 0 && `, ${[d.region, d.country].filter(Boolean).join(', ')}`}{d.notes && ` — ${d.notes}`}</li>)}</ul></section>}

        <section className="card">
          <h2>Itinerary</h2>
          {[...byDay.entries()].map(([d, items]) => (
            <div key={d} style={{ breakInside: 'avoid' }}>
              <h3 className="day-head">Day {dayIndex(trip.start_date, d)} · {formatDateLong(d)}</h3>
              <ul className="list">{items.map((i) => <ItemRow key={i.id} item={rowOf(i.id)} />)}</ul>
            </div>
          ))}
          {data.items.length === 0 && <p>No itinerary items.</p>}
        </section>

        {data.reservations.length > 0 && <section><h2>Reservations</h2>{data.reservations.map((r) => <ReservationCard key={r.id} r={r} />)}<p className="muted print-only">Types: {Object.values(KIND_LABELS).join(', ')}</p></section>}

        {(trip.notes || data.notes.some((n) => n.scope === 'trip')) && (
          <section className="card"><h2>Important notes</h2>{trip.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{trip.notes}</p>}{data.notes.filter((n) => n.scope === 'trip').map((n) => <p key={n.id} style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>)}</section>
        )}

        <section className="card">
          <h2>Packing list</h2>
          {(() => { const p = packingProgress(shared); return <p>Shared list: {p.packed} / {p.total} packed ({p.percent}%)</p>; })()}
          {data.packingCategories.filter((c) => c.is_shared).map((c) => (
            <div key={c.id}><h3>{c.name}</h3><ul style={{ listStyle: 'none', paddingLeft: 0 }}>{shared.filter((i) => i.categoryId === c.id).map((i) => <li key={i.id}>{i.packed ? '☑' : '☐'} {i.name}{i.quantity > 1 ? ` ×${i.quantity}` : ''}</li>)}</ul></div>
          ))}
        </section>

        <section className="card">
          <h2>Expense summary</h2>
          <p>Total: {Object.entries(totals).map(([c, v]) => formatMoney(v, c)).join(' · ') || '—'}{Object.keys(totals).length > 1 && ` (${NO_CONVERSION_NOTICE})`}</p>
          {data.expenses.length > 0 && (
            <div className="table-wrap"><table>
              <caption className="sr-only">Expenses</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Paid by</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>{data.expenses.map((e) => <tr key={e.id}><td>{e.expense_date}</td><td>{e.description}</td><td>{nameOf(data, e.paid_by)}</td><td className="num">{formatMoney(e.amount_cents, e.currency)}</td></tr>)}</tbody>
            </table></div>
          )}
          <h3>Who owes whom</h3>
          {transfers.length === 0 ? <p>Everyone is settled up.</p> : <ul>{transfers.map((t, i) => <li key={i}>{nameOf(data, t.from)} → {nameOf(data, t.to)}: {formatMoney(t.amountCents, t.currency)}</li>)}</ul>}
        </section>
      </article>
    </div>
  );
}
