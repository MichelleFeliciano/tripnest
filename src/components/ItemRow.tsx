import type { ItineraryRow } from '../api/types';
import { ITEM_ICONS, ITEM_LABELS } from '../lib/itinerary';
import { formatTime, zoneAbbr } from '../lib/time';
import { formatMoney } from '../lib/money';
import { SafeLink } from './ui';

export function timeLabel(i: ItineraryRow): { main: string; tz: string | null } {
  if (!i.start_at || !i.start_tz) return { main: 'All day', tz: null };
  const start = formatTime(i.start_at, i.start_tz);
  const sameZone = !i.end_tz || i.end_tz === i.start_tz;
  let main = start;
  if (i.end_at && i.end_tz) main += ` – ${formatTime(i.end_at, i.end_tz)}${sameZone ? '' : ` ${zoneAbbr(i.end_at, i.end_tz)}`}`;
  return { main, tz: zoneAbbr(i.start_at, i.start_tz) };
}

export default function ItemRow({ item, conflict, onEdit, canEdit }: { item: ItineraryRow; conflict?: string; onEdit?: (i: ItineraryRow) => void; canEdit?: boolean }) {
  const t = timeLabel(item);
  return (
    <li className={`item ${conflict ? 'conflict' : ''}`}>
      <div>
        <time>{t.main}</time>
        {t.tz && <span className="tz">{t.tz} (local)</span>}
      </div>
      <div>
        <div className="row-between">
          <strong><span aria-hidden="true">{ITEM_ICONS[item.item_type]} </span>{item.title} <span className="sr-only">({ITEM_LABELS[item.item_type]})</span></strong>
          {canEdit && onEdit && <button className="btn btn-sm" onClick={() => onEdit(item)} aria-label={`Edit ${item.title}`}>Edit</button>}
        </div>
        <div className="muted">
          {ITEM_LABELS[item.item_type]}
          {item.location_name && ` · ${item.location_name}`}
          {item.address && ` · ${item.address}`}
        </div>
        {item.description && <p style={{ margin: '4px 0' }}>{item.description}</p>}
        {item.confirmation_number && <div>Confirmation: <span className="conf">{item.confirmation_number}</span></div>}
        {item.cost_cents !== null && item.currency && <div className="muted">Cost: {formatMoney(item.cost_cents, item.currency)}</div>}
        {item.website && <div><SafeLink href={item.website}>Website</SafeLink></div>}
        {item.contact && <div className="muted">{item.contact}</div>}
        {conflict && <div role="note"><strong>Heads up:</strong> {conflict}</div>}
      </div>
    </li>
  );
}
