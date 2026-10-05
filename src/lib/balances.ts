/**
 * Balances and settlement suggestions. Currencies are NEVER mixed or converted:
 * every result is keyed by currency. See docs/EXPENSE_LOGIC.md.
 */
export interface ExpenseLike {
  paidBy: string;
  currency: string;
  amountCents: number;
  splits: { userId: string; amountCents: number }[];
}
export interface SettlementLike {
  fromUser: string; // the person who paid money
  toUser: string; // the person who received it
  currency: string;
  amountCents: number;
}
export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
  currency: string;
}

/** net > 0: the group owes this person; net < 0: this person owes the group. */
export type NetBalances = Record<string, Record<string, number>>; // currency -> userId -> net

export function computeNetBalances(expenses: ExpenseLike[], settlements: SettlementLike[]): NetBalances {
  const out: NetBalances = {};
  const add = (cur: string, user: string, delta: number) => {
    const m = (out[cur] ??= {});
    m[user] = (m[user] ?? 0) + delta;
  };
  for (const e of expenses) {
    add(e.currency, e.paidBy, e.amountCents);
    for (const s of e.splits) add(e.currency, s.userId, -s.amountCents);
  }
  // Paying someone back raises the payer's net and lowers the receiver's.
  for (const s of settlements) {
    add(s.currency, s.fromUser, s.amountCents);
    add(s.currency, s.toUser, -s.amountCents);
  }
  return out;
}

type Entry = { id: string; v: number };
const byAmountThenId = (a: Entry, b: Entry) => b.v - a.v || a.id.localeCompare(b.id);

/**
 * Greedy settlement: repeatedly match the largest debtor with the largest creditor.
 * Produces at most (people - 1) transfers per currency; deterministic (ties by user id).
 * Not guaranteed globally minimal (NP-hard in general) but ideal for trip-sized groups.
 */
export function suggestSettlements(net: NetBalances): Transfer[] {
  const transfers: Transfer[] = [];
  for (const currency of Object.keys(net).sort()) {
    const creditors: Entry[] = Object.entries(net[currency]).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
    const debtors: Entry[] = Object.entries(net[currency]).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    while (creditors.length && debtors.length) {
      const c = creditors[0];
      const d = debtors[0];
      const amt = Math.min(c.v, d.v);
      transfers.push({ from: d.id, to: c.id, amountCents: amt, currency });
      c.v -= amt;
      d.v -= amt;
      if (c.v === 0) creditors.shift();
      if (d.v === 0) debtors.shift();
      creditors.sort(byAmountThenId);
      debtors.sort(byAmountThenId);
    }
  }
  return transfers;
}

/** Sum of everything spent, per currency (for dashboard totals; no conversion). */
export function totalsByCurrency(expenses: { currency: string; amountCents: number }[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const e of expenses) t[e.currency] = (t[e.currency] ?? 0) + e.amountCents;
  return t;
}

export function hasMixedCurrencies(expenses: { currency: string }[]): boolean {
  return new Set(expenses.map((e) => e.currency)).size > 1;
}
export const NO_CONVERSION_NOTICE = 'Currency conversion not included.';
