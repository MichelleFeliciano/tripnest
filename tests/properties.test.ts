/**
 * Property tests: thousands of generated cases per rule, using a seeded generator so any failure is reproducible.
 */
import { describe, expect, it } from 'vitest';
import { localDate, localTime, tzOffsetMs, zonedToUtc } from '../src/lib/time';
import { computeNetBalances, suggestSettlements, type ExpenseLike, type SettlementLike } from '../src/lib/balances';
import { computeSplits, type SplitMethod } from '../src/lib/splits';
import { MoneyError, formatMoney, minorToInput, parseMoney, currencyExponent } from '../src/lib/money';
import { buildIcs, escapeText, foldLine } from '../src/lib/ics';
import { summarizeBudget, BUDGET_CATEGORIES, EXPENSE_CATEGORIES } from '../src/lib/budget';
import { findConflicts, sortItems, type ItemLike } from '../src/lib/itinerary';
import { addDays, tripDates, tripDuration } from '../src/lib/trip';

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[int(r, 0, xs.length - 1)];

describe('time zones: wall-clock time survives a round trip through UTC', () => {
  // Includes half-hour and 45-minute zones and southern-hemisphere DST.
  const ZONES = ['America/Chicago', 'America/New_York', 'America/Puerto_Rico', 'America/Sao_Paulo', 'Europe/London', 'Europe/Madrid', 'Africa/Cairo', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'Australia/Sydney', 'Australia/Lord_Howe', 'Pacific/Auckland', 'Pacific/Honolulu', 'Pacific/Chatham', 'UTC'];
  const TIMES = ['00:00', '00:30', '01:30', '02:30', '03:30', '12:00', '23:30', '23:59'];

  it('local -> UTC -> local is the identity, except inside a spring-forward gap where it rolls forward', () => {
    let checked = 0, gaps = 0;
    for (const tz of ZONES) {
      for (let day = 0; day < 366; day++) {
        const date = addDays('2027-01-01', day);
        for (const time of TIMES) {
          const utc = zonedToUtc(date, time, tz);
          expect(Number.isFinite(utc.getTime()), `${tz} ${date} ${time}`).toBe(true);
          const backDate = localDate(utc, tz);
          const backTime = localTime(utc, tz);
          checked++;
          if (backDate === date && backTime === time) continue;
          // not an identity: must be a nonexistent time that moved FORWARD (never backward, never by more than the gap)
          gaps++;
          const wanted = Date.parse(`${date}T${time}:00Z`);
          const got = Date.parse(`${backDate}T${backTime}:00Z`);
          expect(got, `${tz} ${date} ${time} -> ${backDate} ${backTime}`).toBeGreaterThan(wanted);
          expect(got - wanted, `${tz} ${date} ${time} moved too far`).toBeLessThanOrEqual(2 * 3_600_000);
        }
      }
    }
    expect(checked).toBeGreaterThan(40_000);
    expect(gaps).toBeGreaterThan(0); // the test really did visit daylight-saving gaps
    expect(gaps).toBeLessThan(checked * 0.02); // and they are rare, as they should be
  });

  it('later wall-clock times never map to earlier instants within a day (monotonic)', () => {
    for (const tz of ZONES) {
      for (let day = 0; day < 366; day += 1) {
        const date = addDays('2027-01-01', day);
        let prev = -Infinity;
        for (const time of TIMES) {
          const t = zonedToUtc(date, time, tz).getTime();
          expect(t, `${tz} ${date} ${time}`).toBeGreaterThanOrEqual(prev);
          prev = t;
        }
      }
    }
  });

  it('the offset used always matches the zone at that instant', () => {
    const r = rng(7);
    for (let i = 0; i < 5000; i++) {
      const tz = pick(r, ZONES);
      const date = addDays('2027-01-01', int(r, 0, 364));
      const time = `${String(int(r, 0, 23)).padStart(2, '0')}:${pick(r, ['00', '15', '30', '45'])}`;
      const utc = zonedToUtc(date, time, tz);
      const wall = Date.parse(`${localDate(utc, tz)}T${localTime(utc, tz)}:00Z`);
      expect(wall - utc.getTime(), `${tz} ${date} ${time}`).toBe(tzOffsetMs(utc.getTime(), tz));
    }
  });
});

describe('balances and settlements', () => {
  const people = ['a', 'b', 'c', 'd', 'e'];
  function randomLedger(r: () => number) {
    const n = int(r, 2, 5);
    const who = people.slice(0, n);
    const expenses: ExpenseLike[] = [];
    for (let i = 0; i < int(r, 0, 12); i++) {
      const total = int(r, 1, 500_000);
      const chosen = who.filter(() => r() < 0.7);
      const part = chosen.length ? chosen : [who[0]];
      const method = pick(r, ['equal', 'percent', 'shares', 'custom'] as SplitMethod[]);
      let inputs;
      if (method === 'equal') inputs = part.map((userId) => ({ userId }));
      else if (method === 'shares') inputs = part.map((userId) => ({ userId, value: int(r, 1, 6) }));
      else if (method === 'percent') {
        let left = 10000;
        inputs = part.map((userId, k) => { const v = k === part.length - 1 ? left : int(r, 0, left); left -= v; return { userId, value: v }; });
      } else {
        let left = total;
        inputs = part.map((userId, k) => { const v = k === part.length - 1 ? left : int(r, 0, left); left -= v; return { userId, value: v }; });
      }
      const splits = computeSplits(total, method, inputs).map((s) => ({ userId: s.userId, amountCents: s.amountCents }));
      expenses.push({ paidBy: pick(r, who), currency: pick(r, ['USD', 'USD', 'EUR']), amountCents: total, splits });
    }
    const settlements: SettlementLike[] = [];
    for (let i = 0; i < int(r, 0, 4); i++) {
      const from = pick(r, who); let to = pick(r, who); if (to === from) to = who[(who.indexOf(from) + 1) % who.length];
      settlements.push({ fromUser: from, toUser: to, currency: pick(r, ['USD', 'EUR']), amountCents: int(r, 1, 50_000) });
    }
    return { expenses, settlements };
  }

  it('net balances sum to zero in every currency; the suggested payments clear everyone using at most n-1 transfers', () => {
    const r = rng(2027);
    for (let i = 0; i < 3000; i++) {
      const { expenses, settlements } = randomLedger(r);
      const net = computeNetBalances(expenses, settlements);
      for (const cur of Object.keys(net)) expect(Object.values(net[cur]).reduce((a, b) => a + b, 0), `case ${i} ${cur}`).toBe(0);
      const transfers = suggestSettlements(net);
      const after: Record<string, Record<string, number>> = JSON.parse(JSON.stringify(net));
      for (const t of transfers) {
        expect(t.amountCents).toBeGreaterThan(0);
        expect(t.from).not.toBe(t.to);
        after[t.currency][t.from] += t.amountCents;
        after[t.currency][t.to] -= t.amountCents;
      }
      for (const cur of Object.keys(after)) for (const v of Object.values(after[cur])) expect(v, `case ${i}`).toBe(0);
      for (const cur of Object.keys(net)) {
        const involved = Object.values(net[cur]).filter((v) => v !== 0).length;
        expect(transfers.filter((t) => t.currency === cur).length, `case ${i} ${cur}`).toBeLessThanOrEqual(Math.max(0, involved - 1));
      }
    }
  });

  it('is deterministic and independent of the order people appear in', () => {
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const { expenses, settlements } = randomLedger(r);
      const a = suggestSettlements(computeNetBalances(expenses, settlements));
      const b = suggestSettlements(computeNetBalances([...expenses].reverse(), [...settlements].reverse()));
      expect(b).toEqual(a);
    }
  });
});

describe('money', () => {
  it('parse and format round-trip exactly for every currency exponent', () => {
    const r = rng(5);
    for (const cur of ['USD', 'JPY', 'BHD', 'EUR']) {
      const exp = currencyExponent(cur);
      for (let i = 0; i < 2000; i++) {
        const minor = int(r, 0, 99_999_999_999);
        expect(parseMoney(minorToInput(minor, cur), cur), `${cur} ${minor}`).toBe(minor);
        expect(typeof formatMoney(minor, cur, 'en-US')).toBe('string');
      }
      expect(exp).toBeGreaterThanOrEqual(0);
    }
  });
  it('never throws anything but MoneyError on arbitrary text, and never returns an unsafe number', () => {
    const r = rng(99);
    const alphabet = '0123456789.,-+$€ abcxXeE\t\n';
    for (let i = 0; i < 20_000; i++) {
      const s = Array.from({ length: int(r, 0, 14) }, () => alphabet[int(r, 0, alphabet.length - 1)]).join('');
      try {
        const v = parseMoney(s);
        expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
      } catch (e) {
        expect(e, JSON.stringify(s)).toBeInstanceOf(MoneyError);
      }
    }
  });
});

describe('calendar export', () => {
  it('survives hostile text: every physical line is within 75 bytes and unfolding restores the content', () => {
    const r = rng(3);
    const chars = ['a', 'b', ' ', ',', ';', '\\', '\n', '\r', '✈️', 'é', '日', '😀', ':', '"', '\t'];
    for (let i = 0; i < 1500; i++) {
      const text = Array.from({ length: int(r, 0, 120) }, () => pick(r, chars)).join('');
      const ics = buildIcs('Cal', [{ id: `id${i}`, title: text || 'x', description: text, location: text, localDate: '2027-06-12', startAt: '2027-06-12T13:00:00.000Z', startTz: 'America/Chicago', endAt: '2027-06-12T14:00:00.000Z', endTz: 'America/Chicago' }]);
      for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${escapeText(text || 'x')}`);
      expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      const escaped = 'X' + escapeText(text); // foldLine only ever sees already-escaped text (no raw line breaks)
      expect(foldLine(escaped).replace(/\r\n /g, '')).toBe(escaped);
    }
  });
});

describe('budgets', () => {
  it('percent used, remaining and status are consistent for random inputs', () => {
    const r = rng(13);
    for (let i = 0; i < 3000; i++) {
      const budget = int(r, 0, 1_000_000);
      const exps = Array.from({ length: int(r, 0, 8) }, () => ({ category: pick(r, EXPENSE_CATEGORIES), amountCents: int(r, 1, 200_000), currency: pick(r, ['USD', 'USD', 'EUR']) }));
      const near = int(r, 1, 100);
      const s = summarizeBudget([{ category: null, amountCents: budget, currency: 'USD' }, ...BUDGET_CATEGORIES.slice(0, 2).map((c) => ({ category: c, amountCents: budget, currency: 'USD' }))], exps, near);
      const actual = exps.filter((e) => e.currency === 'USD').reduce((a, e) => a + e.amountCents, 0);
      expect(s.total!.actualCents).toBe(actual);
      expect(s.total!.remainingCents).toBe(budget - actual);
      expect(s.excludedForeignCurrency).toBe(exps.filter((e) => e.currency !== 'USD').length);
      if (budget > 0) {
        expect(s.total!.status).toBe(actual > budget ? 'over' : actual * 100 >= budget * near ? 'near' : 'under');
        expect(s.total!.percentUsed).toBe(Math.floor((actual * 100) / budget));
      } else expect(s.total!.status).toBe('none');
    }
  });
});

describe('itinerary ordering and conflicts', () => {
  const mk = (id: string, date: string, startMin: number | null, durMin: number | null, type: ItemLike['itemType'] = 'activity'): ItemLike => {
    const base = Date.parse(`${date}T00:00:00Z`);
    return { id, title: id, itemType: type, localDate: date, startAt: startMin === null ? null : new Date(base + startMin * 60_000).toISOString(), startTz: startMin === null ? null : 'UTC', endAt: startMin === null || durMin === null ? null : new Date(base + (startMin + durMin) * 60_000).toISOString(), endTz: startMin === null || durMin === null ? null : 'UTC', sortOrder: 0 };
  };
  it('sorting is stable, total and idempotent; conflicts are symmetric, irreflexive and match a brute-force check', () => {
    const r = rng(21);
    for (let round = 0; round < 400; round++) {
      const items = Array.from({ length: int(r, 0, 14) }, (_, i) =>
        mk(`i${i}`, pick(r, ['2027-06-12', '2027-06-13']), r() < 0.2 ? null : int(r, 0, 600), r() < 0.3 ? null : int(r, 0, 180), pick(r, ['activity', 'restaurant', 'hotel', 'free_time', 'flight'] as const)));
      const sorted = sortItems(items);
      expect(sorted).toHaveLength(items.length);
      expect(sortItems(sorted).map((i) => i.id)).toEqual(sorted.map((i) => i.id));
      for (let k = 1; k < sorted.length; k++) expect(sorted[k - 1].localDate <= sorted[k].localDate).toBe(true);

      const found = new Set(findConflicts(items).map((c) => [c.a, c.b].sort().join('|')));
      const expected = new Set<string>();
      const timed = items.filter((i) => i.startAt && !['hotel', 'free_time'].includes(i.itemType));
      for (let x = 0; x < timed.length; x++) for (let y = x + 1; y < timed.length; y++) {
        const a = timed[x], b = timed[y];
        const as = Date.parse(a.startAt!), ae = a.endAt ? Date.parse(a.endAt) : as;
        const bs = Date.parse(b.startAt!), be = b.endAt ? Date.parse(b.endAt) : bs;
        const overlap = as === bs || (as < be && bs < ae);
        if (overlap) expected.add([a.id, b.id].sort().join('|'));
      }
      expect([...found].sort(), `round ${round}`).toEqual([...expected].sort());
      for (const c of findConflicts(items)) expect(c.a).not.toBe(c.b);
    }
  });
});

describe('trip dates', () => {
  it('duration, date lists and addDays agree across years, leap days and month ends', () => {
    const r = rng(8);
    for (let i = 0; i < 3000; i++) {
      const start = addDays('2024-01-01', int(r, 0, 2000));
      const nights = int(r, 0, 60);
      const end = addDays(start, nights);
      const { days, nights: n } = tripDuration(start, end);
      expect(n).toBe(nights);
      expect(days).toBe(nights + 1);
      const list = tripDates(start, end);
      expect(list).toHaveLength(days);
      expect(list[0]).toBe(start);
      expect(list[list.length - 1]).toBe(end);
      for (let k = 1; k < list.length; k++) expect(list[k] > list[k - 1]).toBe(true);
    }
  });
});
