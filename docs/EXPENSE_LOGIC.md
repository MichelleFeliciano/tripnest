# Expense logic

All of this is deterministic code in `src/lib/{money,splits,balances,budget}.ts`. **No AI is involved in any calculation.**

## Representation
Money is an integer number of *minor units* (`amount_cents`): cents for USD, whole yen for JPY (exponent 0), 3 decimals for BHD/KWD, default exponent 2. Floats never take part in arithmetic. Decimal text is parsed with string operations (`parseMoney`), so `"0.29"` is exactly `29`. Parsing rejects negatives, junk, more decimals than the currency allows, and absurd magnitudes (> 10^11 minor units). The database stores `bigint` with `CHECK (amount_cents > 0)`.

## Splitting (`computeSplits`)
Every method returns amounts that sum **exactly** to the total, or throws.

| Method | Input | Rule |
|---|---|---|
| Equal | none | `base = floor(total / n)`; the leftover cents (`total - base*n`, fewer than `n`) go one each to the **last** participants. $100 / 3 = 33.33, 33.33, 33.34. |
| Custom | amount per person (minor units) | Must sum exactly to the total, otherwise rejected (the message states how far off it is). Zero is allowed, negatives are not. |
| Percent | basis points (50.00% = 5000) | Must sum to exactly 10000 (100.00%). Amounts by **largest remainder**. |
| Shares | positive integers | Amounts by largest remainder (weights = shares). |

**Largest-remainder rounding:** give everyone `floor(total * weight / sumWeights)`, then hand the remaining cents one at a time to the people with the biggest fractional remainders (ties go to the earlier participant in the list). All arithmetic is integer; `total * weight` stays below 2^53 because amounts are capped at 10^11 minor units (1 billion major units) times 10,000 basis points. Rounding therefore can never create or lose a cent. Tests check this for every total from 1 to 300 across many weightings.

Also rejected: empty participant list, duplicate participants, non-integer or non-positive totals.

### Enforcement beyond the UI
1. `save_expense` (Postgres function) re-validates membership of payer and every participant, non-negative splits, and `sum(splits) = amount`, inside one transaction.
2. A **deferred constraint trigger** re-checks `sum(splits) = amount` at commit, for any writer.
3. Direct `INSERT/UPDATE` on `expenses`, `expense_splits` and `settlements` is revoked from clients.

## Balances (`computeNetBalances`)
For each currency and person: `net = paid − owed`, where `owed` is that person's split amount.
Recorded settlements adjust it: the person who **paid** gets `+amount`, the person who **received** gets `−amount`.
`net > 0` means the group owes them; `net < 0` means they owe the group. Nets always sum to zero.

Example: Michelle paid $300, Jon paid $100, split equally between the two. Each owes $200. Michelle net = +$100, Jon net = −$100, so **Jon owes Michelle $100**.

## Settlement suggestions (`suggestSettlements`)
Greedy matching per currency: repeatedly pay the largest creditor from the largest debtor with `min(credit, debt)`, then re-sort. Each step zeroes at least one person, so there are at most *(people − 1)* transfers. Ties are broken by user id, making output deterministic.

Example: M owes J $20, J owes F $30, F owes M $10 gives nets M −10, J −10, F +20, so two transfers (M→F $10, J→F $10) instead of three.
This is not guaranteed to be the global minimum (that problem is NP-hard in general), but it is optimal-or-near for trip-sized groups and easy to explain.

## Recording payments
"Mark as paid" calls `record_settlement` and appends a row (who paid, who received, amount, currency, date, optional note). Partial payments are allowed; an overpayment flips the direction. The ledger is append-only: no update or delete is possible for clients, so history is never silently altered. To correct a mistake, record an opposite entry. No money moves through TripNest.
Deleting an expense changes balances going forward but does not touch settlement rows.

## Currencies
Each expense has its own currency. Balances, totals and suggestions are computed **per currency and never combined**. Whenever more than one currency is present the UI shows "Currency conversion not included." No exchange rates are invented or fetched. If conversion is added later it must show the rate, its source and timestamp, and never convert silently.

## Budgets (`budget.ts`)
Expense categories roll up into budget categories (Gas → Transportation, Tickets → Activities). Status uses integer math: `over` if actual > budget, `near` if `actual*100 >= budget*near%` (default 80, configurable per trip), else `under`. Messages are calm ("You've used 82% of your food budget."). Statuses are shown with text and icon, not colour alone. Expenses in a currency different from the budget's are excluded and flagged rather than converted. Budgets count the full expense amount (what the trip spent), not an individual's share.
