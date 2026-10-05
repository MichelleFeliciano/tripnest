import type { ItemLike } from '../lib/itinerary';
import type { IcsItem } from '../lib/ics';
import type { ExpenseLike, SettlementLike } from '../lib/balances';
import type { PackingItemLike } from '../lib/packing';
import type { Expense, ItineraryRow, PackingItem, Settlement, TripData } from './types';

export const itemLike = (r: ItineraryRow): ItemLike & ItineraryRow => ({
  ...r,
  itemType: r.item_type,
  localDate: r.local_date,
  startAt: r.start_at,
  startTz: r.start_tz,
  endAt: r.end_at,
  endTz: r.end_tz,
  sortOrder: r.sort_order,
});

export const icsItem = (r: ItineraryRow): IcsItem => ({
  id: r.id,
  title: r.title,
  description: r.description,
  location: r.location_name,
  address: r.address,
  localDate: r.local_date,
  startAt: r.start_at,
  startTz: r.start_tz,
  endAt: r.end_at,
  endTz: r.end_tz,
  website: r.website,
  confirmationNumber: r.confirmation_number,
});

export const expenseLike = (e: Expense): ExpenseLike => ({
  paidBy: e.paid_by,
  currency: e.currency,
  amountCents: e.amount_cents,
  splits: e.expense_splits.map((s) => ({ userId: s.user_id, amountCents: s.amount_cents })),
});

export const settlementLike = (s: Settlement) => ({ fromUser: s.from_user, toUser: s.to_user, currency: s.currency, amountCents: s.amount_cents }) satisfies SettlementLike;

export const packingLike = (p: PackingItem): PackingItemLike => ({
  id: p.id,
  name: p.name,
  categoryId: p.category_id,
  quantity: p.quantity,
  packed: p.packed,
  assignedTo: p.assigned_to,
  isShared: p.is_shared,
  ownerId: p.owner_id,
});

export function nameOf(data: TripData, userId: string | null | undefined): string {
  if (!userId) return 'Someone';
  const m = data.members.find((x) => x.user_id === userId);
  return m?.profile?.display_name || m?.profile?.email || 'Former traveler';
}
