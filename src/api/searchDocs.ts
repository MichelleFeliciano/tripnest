import { nameOf, packingLike } from './adapters';
import type { TripData } from './types';
import { formatMoney } from '../lib/money';
import { visibleItems } from '../lib/packing';
import type { SearchDoc } from '../lib/search';
import { formatDateShort } from '../lib/time';

export const SEARCH_LABEL: Record<SearchDoc['kind'], string> = { trip: 'Trip', itinerary: 'Itinerary', reservation: 'Reservation', note: 'Note', packing: 'Packing', expense: 'Expense', todo: 'To-do' };
export const SEARCH_PATH: Record<SearchDoc['kind'], string> = { trip: '', itinerary: 'itinerary', reservation: 'reservations', note: 'notes', packing: 'packing', expense: 'expenses', todo: 'todo' };

/** Everything searchable in one trip. Other people's personal packing lists are left out, as everywhere else. */
export function buildSearchDocs(data: TripData, me: string): SearchDoc[] {
  const visible = new Set(visibleItems(data.packingItems.map(packingLike), me).map((i) => i.id));
  return [
    ...data.items.map((i): SearchDoc => ({ kind: 'itinerary', id: i.id, title: i.title, detail: `${formatDateShort(i.local_date)}${i.location_name ? ` · ${i.location_name}` : ''}`, haystack: [i.description, i.address, i.notes, i.confirmation_number, i.contact, i.website].filter(Boolean).join(' ') })),
    ...data.reservations.map((r): SearchDoc => ({ kind: 'reservation', id: r.id, title: r.title, detail: r.provider ?? '', haystack: [r.confirmation_number, r.address, r.notes, r.phone, ...Object.values(r.details ?? {})].filter(Boolean).join(' ') })),
    ...data.notes.map((n): SearchDoc => ({ kind: 'note', id: n.id, title: n.body.slice(0, 80), detail: '', haystack: n.body })),
    ...data.packingItems.filter((p) => visible.has(p.id)).map((p): SearchDoc => ({ kind: 'packing', id: p.id, title: p.name, detail: p.packed ? 'Packed' : 'Not packed', haystack: p.notes ?? '' })),
    ...data.tasks.map((t): SearchDoc => ({ kind: 'todo', id: t.id, title: t.title, detail: t.done ? 'Done' : t.due_date ? 'Due ' + formatDateShort(t.due_date) : 'To do', haystack: t.notes ?? '' })),
    ...data.expenses.map((e): SearchDoc => ({ kind: 'expense', id: e.id, title: e.description, detail: `${formatMoney(e.amount_cents, e.currency)} · ${nameOf(data, e.paid_by)}`, haystack: `${e.category} ${e.notes ?? ''}` })),
  ];
}
