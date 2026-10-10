import { localTime } from './time';

export const ITEM_TYPES = ['flight', 'hotel', 'restaurant', 'activity', 'transportation', 'event', 'meeting', 'free_time', 'other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_LABELS: Record<ItemType, string> = {
  flight: 'Flight',
  hotel: 'Hotel',
  restaurant: 'Restaurant',
  activity: 'Activity',
  transportation: 'Transportation',
  event: 'Event',
  meeting: 'Meeting',
  free_time: 'Free Time',
  other: 'Other',
};
export const ITEM_ICONS: Record<ItemType, string> = {
  flight: '✈️',
  hotel: '🏨',
  restaurant: '🍽️',
  activity: '🎟️',
  transportation: '🚗',
  event: '🎉',
  meeting: '👥',
  free_time: '🌴',
  other: '📌',
};

export interface ItemLike {
  id: string;
  title: string;
  itemType: ItemType;
  localDate: string; // YYYY-MM-DD in the item's own zone
  startAt: string | null; // ISO instant
  startTz: string | null;
  endAt: string | null;
  endTz: string | null;
  sortOrder: number;
}

/** Chronological: day, then untimed (all-day) first, then instant, then manual order, then title. */
export function sortItems<T extends ItemLike>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
    const ta = a.startAt ? Date.parse(a.startAt) : -Infinity;
    const tb = b.startAt ? Date.parse(b.startAt) : -Infinity;
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.title.localeCompare(b.title);
  });
}

export function groupByDay<T extends ItemLike>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of sortItems(items)) {
    const list = map.get(it.localDate);
    if (list) list.push(it);
    else map.set(it.localDate, [it]);
  }
  return map;
}

export interface Conflict {
  a: string;
  b: string;
  reason: string;
}

/** Item types that legitimately span or overlap other things and are ignored for conflicts. */
const NON_BLOCKING: ItemType[] = ['hotel', 'free_time'];

/**
 * Detects overlapping timed items. An item without an end is treated as an instant
 * (so it conflicts only if it falls strictly inside another item). Touching ends
 * (one ends exactly when the next starts) are not conflicts.
 */
export function findConflicts(items: ItemLike[]): Conflict[] {
  const timed = items
    .filter((i) => i.startAt && !NON_BLOCKING.includes(i.itemType))
    .map((i) => {
      const s = Date.parse(i.startAt!);
      const e = i.endAt ? Date.parse(i.endAt) : s;
      return { i, s, e };
    })
    .sort((x, y) => x.s - y.s || x.e - y.e);
  const out: Conflict[] = [];
  for (let x = 0; x < timed.length; x++) {
    for (let y = x + 1; y < timed.length; y++) {
      if (timed[y].s > timed[x].e) break; // sorted by start: nothing later can overlap x
      // Same start always conflicts; otherwise y must start strictly before x ends (touching is fine).
      const overlap = timed[y].s === timed[x].s || timed[y].s < timed[x].e;
      if (overlap) {
        const a = timed[x].i;
        const b = timed[y].i;
        out.push({
          a: a.id,
          b: b.id,
          reason: `"${a.title}" and "${b.title}" overlap at ${a.startTz ? localTime(timed[y].s, a.startTz) : 'the same time'}.`,
        });
      }
    }
  }
  return out;
}

/**
 * Manual ordering only decides between items that sort as equals: the untimed ("all day") items of a day, or
 * items that start at exactly the same moment. Anything with a different start time is ordered by the clock.
 * Returns that group, in display order.
 */
export function orderGroup<T extends ItemLike>(items: T[], id: string): T[] {
  const me = items.find((i) => i.id === id);
  if (!me) return [];
  return sortItems(items).filter((i) => i.localDate === me.localDate && (i.startAt ? Date.parse(i.startAt) : null) === (me.startAt ? Date.parse(me.startAt) : null));
}

/** Can this item move up (-1) or down (+1) within its group? */
export function canMove<T extends ItemLike>(items: T[], id: string, dir: -1 | 1): boolean {
  const g = orderGroup(items, id);
  const at = g.findIndex((i) => i.id === id);
  return at >= 0 && at + dir >= 0 && at + dir < g.length;
}

/** New sort_order values (0..n-1 for the whole group) after moving one step; empty when it cannot move. */
export function moveWithinGroup<T extends ItemLike>(items: T[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] {
  if (!canMove(items, id, dir)) return [];
  const g = orderGroup(items, id);
  const at = g.findIndex((i) => i.id === id);
  [g[at], g[at + dir]] = [g[at + dir], g[at]];
  return g.map((i, n) => ({ id: i.id, sort_order: n }));
}
