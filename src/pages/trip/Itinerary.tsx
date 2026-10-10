import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { itinerary } from '../../api/api';
import { useToast } from '../../components/Toast';
import { useTrip } from '../../hooks/contexts';
import { itemLike } from '../../api/adapters';
import type { ItineraryRow } from '../../api/types';
import { canMove, findConflicts, groupByDay, moveWithinGroup } from '../../lib/itinerary';
import { addDays, dayIndex, isValidIsoDate, tripDates } from '../../lib/trip';
import { formatDateLong, formatDateShort } from '../../lib/time';
import { Alert, Dialog, Empty } from '../../components/ui';
import ItemRow from '../../components/ItemRow';
import ItemForm from '../../components/ItemForm';

type View = 'timeline' | 'month' | 'week' | 'day';
const VIEWS: [View, string][] = [['timeline', 'Timeline'], ['month', 'Calendar'], ['week', 'Week'], ['day', 'Day']];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function Itinerary() {
  const { data, reload } = useTrip();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const { trip } = data;
  const dates = useMemo(() => tripDates(trip.start_date, trip.end_date), [trip]);
  const view = (VIEWS.find(([v]) => v === sp.get('view'))?.[0] ?? 'timeline') as View;
  const reqDate = sp.get('date');
  const date = reqDate && isValidIsoDate(reqDate) ? reqDate : dates[0];
  const [form, setForm] = useState<{ open: boolean; editing: ItineraryRow | null }>({ open: sp.get('new') === '1', editing: null });

  const likes = useMemo(() => data.items.map(itemLike), [data.items]);
  const byDay = useMemo(() => groupByDay(likes), [likes]);
  const conflicts = useMemo(() => findConflicts(likes), [likes]);
  const conflictFor = (id: string) => conflicts.find((c) => c.a === id || c.b === id)?.reason;
  const rowOf = (id: string) => data.items.find((i) => i.id === id)!;

  const move = async (i: ItineraryRow, dir: -1 | 1) => {
    const updates = moveWithinGroup(likes, i.id, dir);
    if (!updates.length) return;
    try { await itinerary.reorder(updates); await reload(); } catch (e) { toast.say((e as Error).message); }
  };
  const moveFor = (id: string) => ({ canUp: canMove(likes, id, -1), canDown: canMove(likes, id, 1), onMove: move });

  const setView = (v: View, d?: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('view', v); if (d) n.set('date', d); n.delete('new'); return n; }, { replace: true });
  const openNew = () => setForm({ open: true, editing: null });
  const edit = (i: ItineraryRow) => setForm({ open: true, editing: i });
  const close = () => { setForm({ open: false, editing: null }); setSp((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true }); };

  const Day = ({ d }: { d: string }) => {
    const items = byDay.get(d) ?? [];
    return (
      <section aria-labelledby={`day-${d}`}>
        <h2 id={`day-${d}`} className="day-head">Day {dayIndex(trip.start_date, d)} · {formatDateLong(d)}</h2>
        {items.length === 0 ? <p className="muted">Nothing planned yet.{<> <button className="btn btn-sm" onClick={() => { setSp((p) => { const n = new URLSearchParams(p); n.set('date', d); return n; }, { replace: true }); openNew(); }}>Add something</button></>}</p> : (
          <ul className="list">{items.map((i) => <ItemRow key={i.id} item={rowOf(i.id)} conflict={conflictFor(i.id)} canEdit onEdit={edit} move={moveFor(i.id)} />)}</ul>
        )}
      </section>
    );
  };

  const outside = [...byDay.keys()].filter((d) => !dates.includes(d));
  const idx = Math.max(0, dates.indexOf(date));
  const weekStart = Math.floor(idx / 7) * 7;

  const months = useMemo(() => {
    const seen: string[] = [];
    for (const d of dates) { const m = d.slice(0, 7); if (!seen.includes(m)) seen.push(m); }
    return seen;
  }, [dates]);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="seg" role="group" aria-label="Itinerary view">
          {VIEWS.map(([v, label]) => <button key={v} aria-pressed={view === v} onClick={() => setView(v, v === 'timeline' ? undefined : date)}>{label}</button>)}
        </div>
        {<button className="btn btn-primary" onClick={openNew}>+ Add item</button>}
      </div>

      {conflicts.length > 0 && <Alert kind="warn">{conflicts.length} possible schedule {conflicts.length === 1 ? 'overlap' : 'overlaps'} found. They're highlighted below. Nothing was changed.</Alert>}
      {data.items.length === 0 && <Empty title="Your itinerary is empty">{'Add a flight, hotel check-in or dinner to get started.'}</Empty>}

      {view === 'timeline' && data.items.length > 0 && dates.map((d) => <Day key={d} d={d} />)}
      {view === 'timeline' && outside.map((d) => <Day key={d} d={d} />)}

      {view === 'month' && (
        <>
          {months.map((m) => {
            const [y, mo] = m.split('-').map(Number);
            const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
            const len = new Date(Date.UTC(y, mo, 0)).getUTCDate();
            const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: len }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
            while (cells.length % 7) cells.push(null);
            const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
            return (
              <div key={m} className="card">
                <table className="cal">
                  <caption>{MONTHS[mo - 1]} {y}</caption>
                  <thead><tr>{WEEKDAYS.map((w) => <th key={w} scope="col" abbr={w}>{w}</th>)}</tr></thead>
                  <tbody>
                    {weeks.map((wk, i) => (
                      <tr key={i}>
                        {wk.map((d, j) => {
                          if (!d) return <td key={j} />;
                          const n = byDay.get(d)?.length ?? 0;
                          const inTrip = dates.includes(d);
                          return (
                            <td key={j}>
                              <button disabled={!inTrip && n === 0} aria-pressed={d === date} onClick={() => setView('day', d)} aria-label={`${formatDateLong(d)}, ${n} ${n === 1 ? 'item' : 'items'}`}>
                                <span>{Number(d.slice(8))}</span>
                                {n > 0 && <span className="count">{n} ●</span>}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          <p className="muted">Select a day to see its schedule.</p>
        </>
      )}

      {view === 'week' && (
        <>
          <div className="row-between">
            <button className="btn btn-sm" disabled={weekStart === 0} onClick={() => setView('week', dates[weekStart - 7])}>← Previous week</button>
            <strong>{formatDateShort(dates[weekStart])} – {formatDateShort(dates[Math.min(weekStart + 6, dates.length - 1)])}</strong>
            <button className="btn btn-sm" disabled={weekStart + 7 >= dates.length} onClick={() => setView('week', dates[weekStart + 7])}>Next week →</button>
          </div>
          {dates.slice(weekStart, weekStart + 7).map((d) => <Day key={d} d={d} />)}
        </>
      )}

      {view === 'day' && (
        <>
          <div className="row-between">
            <button className="btn btn-sm" disabled={idx === 0} onClick={() => setView('day', addDays(date, -1))}>← Previous</button>
            <label className="row"><span className="sr-only">Choose a day</span>
              <select value={date} onChange={(e) => setView('day', e.target.value)}>{dates.map((d) => <option key={d} value={d}>Day {dayIndex(trip.start_date, d)} · {formatDateShort(d)}</option>)}</select>
            </label>
            <button className="btn btn-sm" disabled={idx >= dates.length - 1} onClick={() => setView('day', addDays(date, 1))}>Next →</button>
          </div>
          <Day d={date} />
        </>
      )}

      <Dialog open={form.open} onClose={close} title={form.editing ? 'Edit itinerary item' : 'Add itinerary item'}>
        <ItemForm editing={form.editing} defaultDate={reqDate && isValidIsoDate(reqDate) ? reqDate : undefined} onDone={close} onCancel={close} />
      </Dialog>
    </div>
  );
}
