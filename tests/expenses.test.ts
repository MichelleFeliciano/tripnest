import { describe, expect, it } from 'vitest';
import { computeSplits, parsePercentToBp, SplitError } from '../src/lib/splits';
import { computeNetBalances, suggestSettlements, totalsByCurrency, type ExpenseLike } from '../src/lib/balances';
import { formatMoney, minorToInput, MoneyError, parseMoney } from '../src/lib/money';

const sum = (r: { amountCents: number }[]) => r.reduce((a, b) => a + b.amountCents, 0);
const P = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe('money parsing/formatting (integer minor units)', () => {
  it('parses decimals without float error', () => {
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('0.29')).toBe(29); // 0.29*100 === 28.999.. in floats
    expect(parseMoney('19.99')).toBe(1999);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('$12')).toBe(1200);
    expect(parseMoney('1.005'.slice(0, 4))).toBe(100); // "1.00"
  });
  it('handles zero-decimal currencies', () => {
    expect(parseMoney('1500', 'JPY')).toBe(1500);
    expect(() => parseMoney('15.5', 'JPY')).toThrow(MoneyError);
    expect(formatMoney(1500, 'JPY')).toMatch(/1,500/);
  });
  it('rejects negatives, junk, excess precision, absurd sizes', () => {
    for (const bad of ['-5', 'abc', '', '.', '1.234', '1e5', '12.3.4', '99999999999999999999']) {
      expect(() => parseMoney(bad), bad).toThrow(MoneyError);
    }
  });
  it('round-trips through input format', () => {
    expect(minorToInput(1999)).toBe('19.99');
    expect(minorToInput(5)).toBe('0.05');
    expect(parseMoney(minorToInput(123456))).toBe(123456);
  });
  it('formats', () => {
    expect(formatMoney(10000, 'USD', 'en-US')).toBe('$100.00');
    expect(formatMoney(-2550, 'USD', 'en-US')).toBe('-$25.50');
  });
});

describe('equal split', () => {
  it('$100 / 4 = $25 each', () => {
    expect(computeSplits(10000, 'equal', P('a', 'b', 'c', 'd')).map((s) => s.amountCents)).toEqual([2500, 2500, 2500, 2500]);
  });
  it('$100 / 3 = 33.33, 33.33, 33.34 (remainder to last)', () => {
    expect(computeSplits(10000, 'equal', P('a', 'b', 'c')).map((s) => s.amountCents)).toEqual([3333, 3333, 3334]);
  });
  it('always sums exactly across many totals/people', () => {
    for (let total = 1; total <= 400; total++) {
      for (let n = 1; n <= 9; n++) {
        const ids = Array.from({ length: n }, (_, i) => `u${i}`);
        const r = computeSplits(total, 'equal', P(...ids));
        expect(sum(r)).toBe(total);
        const amts = r.map((x) => x.amountCents);
        expect(Math.max(...amts) - Math.min(...amts)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('1 cent among 3 people', () => {
    expect(computeSplits(1, 'equal', P('a', 'b', 'c')).map((s) => s.amountCents)).toEqual([0, 0, 1]);
  });
});

describe('custom split', () => {
  it('accepts exact sums', () => {
    const r = computeSplits(10000, 'custom', [
      { userId: 'm', value: 5000 },
      { userId: 'j', value: 3000 },
      { userId: 'f', value: 2000 },
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([5000, 3000, 2000]);
  });
  it('rejects sums that are off by even one cent', () => {
    expect(() => computeSplits(10000, 'custom', [{ userId: 'a', value: 5000 }, { userId: 'b', value: 4999 }])).toThrow(SplitError);
    expect(() => computeSplits(10000, 'custom', [{ userId: 'a', value: 5000 }, { userId: 'b', value: 5001 }])).toThrow(SplitError);
  });
  it('rejects negative / fractional / missing values', () => {
    expect(() => computeSplits(100, 'custom', [{ userId: 'a', value: -1 }, { userId: 'b', value: 101 }])).toThrow(SplitError);
    expect(() => computeSplits(100, 'custom', [{ userId: 'a', value: 50.5 }, { userId: 'b', value: 49.5 }])).toThrow(SplitError);
    expect(() => computeSplits(100, 'custom', [{ userId: 'a' }, { userId: 'b', value: 100 }])).toThrow(SplitError);
  });
});

describe('percent split', () => {
  it('50/30/20 of $100', () => {
    const r = computeSplits(10000, 'percent', [
      { userId: 'm', value: 5000 },
      { userId: 'j', value: 3000 },
      { userId: 'f', value: 2000 },
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([5000, 3000, 2000]);
  });
  it('rounding: 33.33/33.33/33.34 of $0.10 still sums exactly', () => {
    const r = computeSplits(10, 'percent', [
      { userId: 'a', value: 3333 },
      { userId: 'b', value: 3333 },
      { userId: 'c', value: 3334 },
    ]);
    expect(sum(r)).toBe(10);
  });
  it('rejects percentages not totalling 100', () => {
    expect(() => computeSplits(100, 'percent', [{ userId: 'a', value: 5000 }, { userId: 'b', value: 4999 }])).toThrow(/100%/);
    expect(() => computeSplits(100, 'percent', [{ userId: 'a', value: 6000 }, { userId: 'b', value: 5000 }])).toThrow(/100%/);
  });
  it('parses percent text', () => {
    expect(parsePercentToBp('33.33')).toBe(3333);
    expect(parsePercentToBp('50%')).toBe(5000);
    expect(parsePercentToBp('12.5')).toBe(1250);
    expect(() => parsePercentToBp('12.345')).toThrow(SplitError);
    expect(() => parsePercentToBp('-5')).toThrow(SplitError);
  });
});

describe('shares split', () => {
  it('2/1/1 of $100 = 50/25/25', () => {
    const r = computeSplits(10000, 'shares', [
      { userId: 'm', value: 2 },
      { userId: 'j', value: 1 },
      { userId: 'f', value: 1 },
    ]);
    expect(r.map((x) => x.amountCents)).toEqual([5000, 2500, 2500]);
  });
  it('indivisible totals still sum exactly (property check)', () => {
    for (let total = 1; total <= 300; total++) {
      for (const w of [[1, 1, 1], [3, 2, 1], [5, 1], [7, 7, 7, 1]]) {
        const r = computeSplits(total, 'shares', w.map((value, i) => ({ userId: `u${i}`, value })));
        expect(sum(r)).toBe(total);
      }
    }
  });
  it('rejects zero / negative / fractional shares', () => {
    for (const v of [0, -1, 1.5]) {
      expect(() => computeSplits(100, 'shares', [{ userId: 'a', value: v }, { userId: 'b', value: 1 }])).toThrow(SplitError);
    }
  });
});

describe('invalid inputs', () => {
  it('rejects non-positive / non-integer totals, empty and duplicate participants', () => {
    expect(() => computeSplits(0, 'equal', P('a'))).toThrow(SplitError);
    expect(() => computeSplits(-100, 'equal', P('a'))).toThrow(SplitError);
    expect(() => computeSplits(10.5, 'equal', P('a'))).toThrow(SplitError);
    expect(() => computeSplits(100, 'equal', [])).toThrow(SplitError);
    expect(() => computeSplits(100, 'equal', P('a', 'a'))).toThrow(SplitError);
  });
});

function expense(paidBy: string, amountCents: number, ids: string[], currency = 'USD'): ExpenseLike {
  return { paidBy, amountCents, currency, splits: computeSplits(amountCents, 'equal', P(...ids)) };
}

describe('balances', () => {
  it('Michelle paid $300, Jon paid $100, split equally -> Jon owes Michelle $100', () => {
    const net = computeNetBalances([expense('michelle', 30000, ['michelle', 'jon']), expense('jon', 10000, ['michelle', 'jon'])], []);
    expect(net.USD).toEqual({ michelle: 10000, jon: -10000 });
    expect(suggestSettlements(net)).toEqual([{ from: 'jon', to: 'michelle', amountCents: 10000, currency: 'USD' }]);
  });
  it('net balances always sum to zero', () => {
    const exps = [expense('a', 12345, ['a', 'b', 'c']), expense('b', 999, ['a', 'c']), expense('c', 1, ['a', 'b', 'c'])];
    const net = computeNetBalances(exps, []);
    expect(Object.values(net.USD).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('multiple expenses across people', () => {
    const net = computeNetBalances(
      [expense('a', 9000, ['a', 'b', 'c']), expense('b', 3000, ['a', 'b', 'c']), expense('c', 0 + 600, ['a', 'b', 'c'])],
      [],
    );
    expect(net.USD).toEqual({ a: 9000 - 4200, b: 3000 - 4200, c: 600 - 4200 });
  });
});

describe('settlement optimization', () => {
  it('collapses the circular example into fewer transfers', () => {
    // Michelle owes Jon 20, Jon owes Friend 30, Friend owes Michelle 10
    const net = computeNetBalances(
      [],
      [
        { fromUser: 'michelle', toUser: 'jon', amountCents: 0, currency: 'USD' },
      ],
    );
    expect(net).toEqual({ USD: { michelle: 0, jon: 0 } });
    // Express the three debts as net positions directly: M: -20+10=-10, J: +20-30=-10, F: +30-10=+20
    const transfers = suggestSettlements({ USD: { michelle: -1000, jon: -1000, friend: 2000 } });
    expect(transfers).toHaveLength(2); // instead of 3
    expect(transfers.reduce((a, t) => a + t.amountCents, 0)).toBe(2000);
    expect(transfers.every((t) => t.to === 'friend')).toBe(true);
  });
  it('never produces more than n-1 transfers and zeroes everyone out', () => {
    const net = { USD: { a: 7000, b: -2500, c: -1500, d: -3000, e: 0 } };
    const t = suggestSettlements(net);
    expect(t.length).toBeLessThanOrEqual(3);
    const after: Record<string, number> = { ...net.USD };
    for (const x of t) {
      after[x.from] += x.amountCents;
      after[x.to] -= x.amountCents;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
  it('is deterministic', () => {
    const net = { USD: { a: 100, b: 100, c: -100, d: -100 } };
    expect(suggestSettlements(net)).toEqual(suggestSettlements({ USD: { d: -100, c: -100, b: 100, a: 100 } }));
  });
  it('keeps currencies separate and never converts', () => {
    const net = computeNetBalances(
      [expense('a', 10000, ['a', 'b'], 'USD'), expense('b', 4000, ['a', 'b'], 'EUR')],
      [],
    );
    const t = suggestSettlements(net);
    expect(t).toEqual([
      { from: 'a', to: 'b', amountCents: 2000, currency: 'EUR' },
      { from: 'b', to: 'a', amountCents: 5000, currency: 'USD' },
    ]);
    expect(totalsByCurrency([expense('a', 10000, ['a']), expense('b', 4000, ['a'], 'EUR')])).toEqual({ USD: 10000, EUR: 4000 });
  });
});

describe('partial settlements', () => {
  it('a partial payment reduces the remaining debt without erasing history', () => {
    const exps = [expense('michelle', 20000, ['michelle', 'jon'])]; // Jon owes 100.00
    const settlements = [{ fromUser: 'jon', toUser: 'michelle', amountCents: 4000, currency: 'USD' }];
    const net = computeNetBalances(exps, settlements);
    expect(suggestSettlements(net)).toEqual([{ from: 'jon', to: 'michelle', amountCents: 6000, currency: 'USD' }]);
  });
  it('full settlement leaves no suggested transfers', () => {
    const exps = [expense('michelle', 20000, ['michelle', 'jon'])];
    const net = computeNetBalances(exps, [{ fromUser: 'jon', toUser: 'michelle', amountCents: 10000, currency: 'USD' }]);
    expect(suggestSettlements(net)).toEqual([]);
  });
  it('overpayment flips the direction instead of being lost', () => {
    const exps = [expense('michelle', 20000, ['michelle', 'jon'])];
    const net = computeNetBalances(exps, [{ fromUser: 'jon', toUser: 'michelle', amountCents: 12000, currency: 'USD' }]);
    expect(suggestSettlements(net)).toEqual([{ from: 'michelle', to: 'jon', amountCents: 2000, currency: 'USD' }]);
  });
});

describe('QA regression fixes: money input', () => {
  it('reads a single comma with 1-2 digits as a decimal separator (EUR style)', () => {
    expect(parseMoney('12,50', 'EUR')).toBe(1250);
    expect(parseMoney('0,5', 'EUR')).toBe(50);
    expect(parseMoney('1,234')).toBe(123400); // 3 digits after comma = thousands separator
    expect(parseMoney('1,234.56')).toBe(123456);
  });
  it('percent/shares stay exact at the maximum allowed amount', () => {
    const max = 100_000_000_000;
    const r = computeSplits(max, 'percent', [{ userId: 'a', value: 3333 }, { userId: 'b', value: 3333 }, { userId: 'c', value: 3334 }]);
    expect(r.reduce((a, b) => a + b.amountCents, 0)).toBe(max);
    expect(() => parseMoney('1000000000.01')).toThrow(MoneyError);
  });
});
