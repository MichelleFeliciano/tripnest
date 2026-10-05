import { describe, expect, it } from 'vitest';
import { addDays, formatDateRange, tripDates, tripDuration, validateTrip } from '../src/lib/trip';
import { can, canModifyExpense, inviteRoleAllowed } from '../src/lib/permissions';
import { localDate, localTime, tzOffsetMs, zonedToUtc, formatTime, zoneAbbr, isValidTimeZone } from '../src/lib/time';
import { findConflicts, groupByDay, sortItems, type ItemLike } from '../src/lib/itinerary';
import { expandTemplate, packingProgress, PACKING_TEMPLATES, visibleItems, groupByCategory, itemsFor, type PackingItemLike } from '../src/lib/packing';
import { budgetStatus, summarizeBudget } from '../src/lib/budget';
import { searchDocs } from '../src/lib/search';

describe('trip dates', () => {
  it('Puerto Rico June 12–19 = 8 days, 7 nights', () => {
    expect(tripDuration('2026-06-12', '2026-06-19')).toEqual({ days: 8, nights: 7 });
    expect(formatDateRange('2026-06-12', '2026-06-19')).toBe('June 12–19, 2026');
  });
  it('same day trip', () => {
    expect(tripDuration('2026-06-12', '2026-06-12')).toEqual({ days: 1, nights: 0 });
  });
  it('rejects end before start, bad dates, empty names', () => {
    expect(validateTrip({ name: 'x', startDate: '2026-06-12', endDate: '2026-06-11' })).toContain('End date cannot be before the start date');
    expect(validateTrip({ name: 'x', startDate: '2026-02-30', endDate: '2026-03-01' }).length).toBeGreaterThan(0);
    expect(validateTrip({ name: '  ', startDate: '2026-06-12', endDate: '2026-06-12' })).toContain('Trip name is required');
    expect(validateTrip({ name: 'ok', startDate: '2026-06-12', endDate: '2026-06-12' })).toEqual([]);
  });
  it('handles month/leap boundaries', () => {
    expect(tripDuration('2028-02-27', '2028-03-01')).toEqual({ days: 4, nights: 3 });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(tripDates('2026-06-12', '2026-06-14')).toEqual(['2026-06-12', '2026-06-13', '2026-06-14']);
  });
});

describe('roles & permissions', () => {
  it('owner can do everything', () => {
    for (const a of ['trip.delete', 'trip.archive', 'members.manage', 'expenses.add', 'itinerary.edit'] as const) expect(can('owner', a)).toBe(true);
  });
  it('editor cannot delete/archive the trip or manage members', () => {
    expect(can('editor', 'trip.delete')).toBe(false);
    expect(can('editor', 'trip.archive')).toBe(false);
    expect(can('editor', 'members.manage')).toBe(false);
    expect(can('editor', 'itinerary.edit')).toBe(true);
    expect(can('editor', 'expenses.add')).toBe(true);
    expect(can('editor', 'members.invite')).toBe(true);
  });
  it('viewer is read-only', () => {
    expect(can('viewer', 'trip.view')).toBe(true);
    for (const a of ['itinerary.edit', 'expenses.add', 'packing.editShared', 'notes.edit', 'members.invite', 'documents.upload', 'trip.delete'] as const) expect(can('viewer', a)).toBe(false);
  });
  it('non-members have no access', () => {
    expect(can(null, 'trip.view')).toBe(false);
    expect(can(undefined, 'trip.view')).toBe(false);
  });
  it('editors modify only their own expenses', () => {
    expect(canModifyExpense('owner', 'x', 'y')).toBe(true);
    expect(canModifyExpense('editor', 'y', 'y')).toBe(true);
    expect(canModifyExpense('editor', 'x', 'y')).toBe(false);
    expect(canModifyExpense('viewer', 'y', 'y')).toBe(false);
  });
  it('invitations can never grant ownership; viewers cannot invite', () => {
    expect(inviteRoleAllowed('owner', 'owner' as never)).toBe(false);
    expect(inviteRoleAllowed('editor', 'viewer')).toBe(true);
    expect(inviteRoleAllowed('viewer', 'viewer')).toBe(false);
  });
});

describe('time zones', () => {
  it('Chicago 8:00 AM June 12 (CDT, UTC-5) = 13:00Z', () => {
    expect(zonedToUtc('2026-06-12', '08:00', 'America/Chicago').toISOString()).toBe('2026-06-12T13:00:00.000Z');
  });
  it('Puerto Rico 1:30 PM June 12 (AST, UTC-4) = 17:30Z', () => {
    expect(zonedToUtc('2026-06-12', '13:30', 'America/Puerto_Rico').toISOString()).toBe('2026-06-12T17:30:00.000Z');
  });
  it('the example flight is 4.5 hours long though local clocks differ by 5.5', () => {
    const dep = zonedToUtc('2026-06-12', '08:00', 'America/Chicago');
    const arr = zonedToUtc('2026-06-12', '13:30', 'America/Puerto_Rico');
    expect((arr.getTime() - dep.getTime()) / 3_600_000).toBe(4.5);
  });
  it('renders in the place zone, not the viewer zone', () => {
    const arr = '2026-06-12T17:30:00.000Z';
    expect(formatTime(arr, 'America/Puerto_Rico')).toMatch(/1:30\s?PM/);
    expect(formatTime(arr, 'America/Chicago')).toMatch(/12:30\s?PM/);
    expect(zoneAbbr(arr, 'America/Puerto_Rico')).toBe('AST');
    expect(localTime(arr, 'America/Puerto_Rico')).toBe('13:30');
  });
  it('local date can differ from UTC date', () => {
    expect(localDate('2026-06-13T02:00:00Z', 'America/Chicago')).toBe('2026-06-12');
    expect(localDate('2026-06-12T22:00:00Z', 'Asia/Tokyo')).toBe('2026-06-13');
  });
  it('DST: winter vs summer offsets and round-trip', () => {
    expect(tzOffsetMs(Date.UTC(2026, 0, 15, 12), 'America/Chicago')).toBe(-6 * 3_600_000);
    expect(tzOffsetMs(Date.UTC(2026, 6, 15, 12), 'America/Chicago')).toBe(-5 * 3_600_000);
    const d = zonedToUtc('2026-03-08', '03:30', 'America/Chicago'); // after spring-forward
    expect(localTime(d, 'America/Chicago')).toBe('03:30');
    const e = zonedToUtc('2026-11-01', '12:00', 'America/Chicago'); // after fall-back
    expect(e.toISOString()).toBe('2026-11-01T18:00:00.000Z');
  });
  it('half-hour zones', () => {
    expect(zonedToUtc('2026-06-12', '10:00', 'Asia/Kolkata').toISOString()).toBe('2026-06-12T04:30:00.000Z');
  });
  it('validates zone names', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

function item(id: string, date: string, start: string | null, end: string | null, type: ItemLike['itemType'] = 'activity', order = 0): ItemLike {
  const tz = 'America/Puerto_Rico';
  return {
    id,
    title: id,
    itemType: type,
    localDate: date,
    startAt: start ? zonedToUtc(date, start, tz).toISOString() : null,
    startTz: start ? tz : null,
    endAt: end ? zonedToUtc(date, end, tz).toISOString() : null,
    endTz: end ? tz : null,
    sortOrder: order,
  };
}

describe('itinerary ordering & conflicts', () => {
  it('sorts by day, untimed first, then time, then manual order', () => {
    const items = [item('dinner', '2026-06-12', '19:00', null), item('beach', '2026-06-13', '10:00', null), item('allday', '2026-06-12', null, null), item('lunch', '2026-06-12', '12:00', null), item('b', '2026-06-12', '12:00', null, 'activity', 5)];
    expect(sortItems(items).map((i) => i.id)).toEqual(['allday', 'lunch', 'b', 'dinner', 'beach']);
  });
  it('groups by local day', () => {
    const g = groupByDay([item('a', '2026-06-12', '09:00', null), item('b', '2026-06-13', '09:00', null), item('c', '2026-06-12', '10:00', null)]);
    expect([...g.keys()]).toEqual(['2026-06-12', '2026-06-13']);
    expect(g.get('2026-06-12')!.map((i) => i.id)).toEqual(['a', 'c']);
  });
  it('detects overlaps but not back-to-back items', () => {
    const items = [item('museum', '2026-06-13', '10:00', '12:00'), item('lunch', '2026-06-13', '11:30', '13:00'), item('tour', '2026-06-13', '13:00', '14:00')];
    const c = findConflicts(items);
    expect(c).toHaveLength(1);
    expect([c[0].a, c[0].b].sort()).toEqual(['lunch', 'museum']);
  });
  it('ignores hotels and free time; flags identical start instants', () => {
    expect(findConflicts([item('h', '2026-06-13', '15:00', '23:00', 'hotel'), item('d', '2026-06-13', '19:00', '20:00')])).toEqual([]);
    expect(findConflicts([item('x', '2026-06-13', '19:00', null), item('y', '2026-06-13', '19:00', null)])).toHaveLength(1);
  });
  it('compares across time zones by instant, not wall clock', () => {
    const dep = { ...item('flight', '2026-06-12', null, null, 'flight'), startAt: zonedToUtc('2026-06-12', '08:00', 'America/Chicago').toISOString(), endAt: zonedToUtc('2026-06-12', '13:30', 'America/Puerto_Rico').toISOString(), startTz: 'America/Chicago', endTz: 'America/Puerto_Rico' };
    const taxi = item('taxi', '2026-06-12', '13:00', '13:45'); // 13:00 AST is inside the flight (arrives 13:30 AST)
    expect(findConflicts([dep, taxi])).toHaveLength(1);
    const dinner = item('dinner', '2026-06-12', '14:00', '15:00');
    expect(findConflicts([dep, dinner])).toEqual([]);
  });
});

const pk = (id: string, cat: string, packed: boolean, shared = true, owner: string | null = null, assigned: string | null = null): PackingItemLike => ({ id, name: id, categoryId: cat, quantity: 1, packed, assignedTo: assigned, isShared: shared, ownerId: owner });

describe('packing', () => {
  it('computes 12/20 = 60%', () => {
    const items = Array.from({ length: 20 }, (_, i) => pk(`i${i}`, 'c', i < 12));
    expect(packingProgress(items)).toEqual({ packed: 12, total: 20, percent: 60 });
  });
  it('empty list is 0%', () => {
    expect(packingProgress([])).toEqual({ packed: 0, total: 0, percent: 0 });
  });
  it('personal items are private to their owner', () => {
    const items = [pk('s', 'c', false), pk('mine', 'c', false, false, 'me'), pk('theirs', 'c', false, false, 'jon')];
    expect(visibleItems(items, 'me').map((i) => i.id)).toEqual(['s', 'mine']);
    expect(itemsFor(items, { shared: false, userId: 'me' }).map((i) => i.id)).toEqual(['mine']);
    expect(itemsFor(items, { shared: true, userId: 'me' }).map((i) => i.id)).toEqual(['s']);
  });
  it('groups by category incl. empty custom categories', () => {
    const g = groupByCategory([pk('a', 'c1', false), pk('b', 'c1', true)], ['c1', 'c2']);
    expect(g.get('c1')).toHaveLength(2);
    expect(g.get('c2')).toEqual([]);
  });
  it('templates expand to editable lists with quantities', () => {
    expect(PACKING_TEMPLATES.map((t) => t.name)).toEqual(['Weekend Trip', 'Beach Vacation', 'Business Trip', 'International Trip', 'Road Trip']);
    const beach = expandTemplate(PACKING_TEMPLATES[1]);
    expect(beach.find((c) => c.name === 'Clothing')!.items).toContainEqual({ name: 'Swimsuits', quantity: 2 });
  });
});

describe('budgets', () => {
  it('thresholds', () => {
    expect(budgetStatus(10000, 7999)).toBe('under');
    expect(budgetStatus(10000, 8000)).toBe('near');
    expect(budgetStatus(10000, 10000)).toBe('near');
    expect(budgetStatus(10000, 10001)).toBe('over');
    expect(budgetStatus(0, 100)).toBe('none');
    expect(budgetStatus(10000, 5000, 50)).toBe('near'); // configurable
  });
  it('total + category budgets, remaining, roll-ups, gentle messages', () => {
    const s = summarizeBudget(
      [
        { category: null, amountCents: 200000, currency: 'USD' },
        { category: 'Food', amountCents: 50000, currency: 'USD' },
        { category: 'Transportation', amountCents: 30000, currency: 'USD' },
      ],
      [
        { category: 'Food', amountCents: 41000, currency: 'USD' },
        { category: 'Gas', amountCents: 5000, currency: 'USD' },
        { category: 'Transportation', amountCents: 30000, currency: 'USD' },
        { category: 'Lodging', amountCents: 90000, currency: 'USD' },
        { category: 'Food', amountCents: 999, currency: 'EUR' },
      ],
    );
    expect(s.total).toMatchObject({ actualCents: 166000, remainingCents: 34000, status: 'near', percentUsed: 83 });
    expect(s.categories.find((c) => c.category === 'Food')).toMatchObject({ percentUsed: 82, status: 'near', message: "You've used 82% of your food budget." });
    expect(s.categories.find((c) => c.category === 'Transportation')).toMatchObject({ actualCents: 35000, status: 'over', remainingCents: -5000 });
    expect(s.excludedForeignCurrency).toBe(1);
  });
});

describe('search', () => {
  const docs = [
    { kind: 'itinerary' as const, id: '1', title: 'Dinner at Café Puerto', detail: 'San Juan', haystack: 'ABC123' },
    { kind: 'expense' as const, id: '2', title: 'Gas', detail: '', haystack: '' },
  ];
  it('is case/diacritic-insensitive and AND-matches terms', () => {
    expect(searchDocs(docs, 'cafe puerto').map((d) => d.id)).toEqual(['1']);
    expect(searchDocs(docs, 'abc123')).toHaveLength(1);
    expect(searchDocs(docs, 'dinner gas')).toHaveLength(0);
    expect(searchDocs(docs, '  ')).toEqual([]);
  });
});
