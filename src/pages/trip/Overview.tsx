import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTrip } from '../../hooks/contexts';
import { useNow } from '../../hooks/hooks';
import { nameOf, itemLike, packingLike, expenseLike } from '../../api/adapters';
import { sortItems } from '../../lib/itinerary';
import { localDate, browserTimeZone } from '../../lib/time';
import { packingProgress, visibleItems } from '../../lib/packing';
import { totalsByCurrency, NO_CONVERSION_NOTICE, computeNetBalances, suggestSettlements } from '../../lib/balances';
import { formatMoney } from '../../lib/money';
import { openTaskCounts } from '../../lib/tasks';
import { durationText, formatDateRange } from '../../lib/trip';
import ItemRow from '../../components/ItemRow';
import DestinationsCard from '../../components/DestinationsCard';
import WeatherCard from '../../components/WeatherCard';
import KeyInfoCard from '../../components/KeyInfoCard';
import { ProgressBar } from '../../components/ui';
import { settlementLike } from '../../api/adapters';

export default function Overview() {
  const { data, me } = useTrip();
  const { trip } = data;
  const nowMs = useNow(); // refreshed every minute, so "Today" and "Next up" move on by themselves
  const now = new Date(nowMs);

  const { today, next } = useMemo(() => {
    const sorted = sortItems(data.items.map(itemLike));
    const isToday = (i: (typeof sorted)[number]) => i.localDate === localDate(now, i.startTz ?? browserTimeZone());
    const upcoming = sorted.find((i) => (i.startAt ? Date.parse(i.startAt) >= now.getTime() : i.localDate >= localDate(now, browserTimeZone())));
    return { today: sorted.filter(isToday), next: upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items, nowMs]);

  const totals = totalsByCurrency(data.expenses.map((e) => ({ currency: e.currency, amountCents: e.amount_cents })));
  const mixed = Object.keys(totals).length > 1;
  const visible = visibleItems(data.packingItems.map(packingLike), me);
  const shared = packingProgress(visible.filter((i) => i.isShared));
  const mine = packingProgress(visible.filter((i) => !i.isShared));
  const owes = useMemo(() => {
    const t = suggestSettlements(computeNetBalances(data.expenses.map(expenseLike), data.settlements.map(settlementLike)));
    return t.filter((x) => x.from === me || x.to === me);
  }, [data.expenses, data.settlements, me]);
  const base = `/trips/${trip.id}`;
  const rowOf = (id: string) => data.items.find((i) => i.id === id)!;

  return (
    <div>
      {trip.cover_image_url && /^https:\/\//.test(trip.cover_image_url) && <img className="cover" src={trip.cover_image_url} alt="" referrerPolicy="no-referrer" />}
      <section className="card today-card" aria-labelledby="today-h">
        <h2 id="today-h">Today</h2>
        {today.length > 0 ? <ul className="list">{today.map((i) => <ItemRow key={i.id} item={rowOf(i.id)} />)}</ul> : <p className="muted">Nothing scheduled for today.</p>}
        {next && !today.some((t) => t.id === next.id) && (
          <div style={{ marginTop: 8 }}>
            <h3>Next up</h3>
            <ul className="list"><ItemRow item={rowOf(next.id)} /></ul>
          </div>
        )}
      </section>

      {(
        <div className="row no-print" style={{ marginBottom: 16 }} role="group" aria-label="Quick actions">
          <Link className="btn" to={`${base}/explore`}>🧭 Explore things to do</Link>
          <Link className="btn" to={`${base}/itinerary?new=1`}>+ Itinerary item</Link>
          <Link className="btn" to={`${base}/reservations?new=1`}>+ Reservation</Link>
          <Link className="btn" to={`${base}/expenses?new=1`}>+ Expense</Link>
          <Link className="btn" to={`${base}/packing?new=1`}>+ Packing item</Link>
          <Link className="btn" to={`${base}/members`}>+ Add traveler</Link>
        </div>
      )}

      <div className="grid grid-2">
        <section className="card" aria-labelledby="sum-h">
          <h2 id="sum-h">Trip</h2>
          <dl className="kv">
            <dt>Dates</dt><dd>{formatDateRange(trip.start_date, trip.end_date)}</dd>
            <dt>Length</dt><dd>{durationText(trip.start_date, trip.end_date)}</dd>
            <dt>Destination</dt><dd>{trip.primary_destination ?? '—'}</dd>
            <dt>Travelers</dt><dd>{data.travelers.map((t) => t.name).join(', ')}</dd>
          </dl>
          {trip.description && <p>{trip.description}</p>}
        </section>

        <section className="card" aria-labelledby="money-h">
          <h2 id="money-h">Shared expenses</h2>
          {Object.keys(totals).length === 0 ? <p className="muted">No expenses yet.</p> : Object.entries(totals).map(([c, v]) => <div key={c} className="big-num">{formatMoney(v, c)}</div>)}
          {mixed && <p className="muted">{NO_CONVERSION_NOTICE}</p>}
          {owes.map((t, i) => (
            <p key={i}>{t.from === me ? <>You owe <strong>{nameOf(data, t.to)}</strong></> : <><strong>{nameOf(data, t.from)}</strong> owes you</>} {formatMoney(t.amountCents, t.currency)}</p>
          ))}
          <Link to={`${base}/expenses`}>See balances →</Link>
        </section>

        <section className="card" aria-labelledby="pack-h">
          <h2 id="pack-h">Packing</h2>
          <p><strong>{shared.packed} / {shared.total}</strong> shared items packed ({shared.percent}%)</p>
          <ProgressBar value={shared.percent} label="Shared packing progress" />
          {mine.total > 0 && <p style={{ marginTop: 12 }}><strong>{mine.packed} / {mine.total}</strong> of your personal list ({mine.percent}%)</p>}
          <Link to={`${base}/packing`}>Open packing list →</Link>
        </section>

        <section className="card" aria-labelledby="todo-h">
          <h2 id="todo-h">To-do before you go</h2>
          {data.tasks.length === 0 ? <p className="muted">Nothing on the list yet.</p> : (() => {
            const c = openTaskCounts(data.tasks, localDate(now, browserTimeZone()));
            return <p><strong>{c.open}</strong> still to do{c.overdue > 0 && <strong className="overdue"> · {c.overdue} overdue</strong>}</p>;
          })()}
          <Link to={`${base}/todo`}>Open to-do list →</Link>
        </section>

        <KeyInfoCard />

        <WeatherCard />

        <DestinationsCard />
      </div>
    </div>
  );
}
