/**
 * Deterministic expense splitting. See docs/EXPENSE_LOGIC.md.
 * All amounts are integer minor units; every method returns shares that sum
 * EXACTLY to the total or throws SplitError.
 */
export type SplitMethod = 'equal' | 'custom' | 'percent' | 'shares';

export interface SplitInput {
  userId: string;
  /** custom: amount in minor units; percent: basis points (50% = 5000); shares: positive integer. Ignored for equal. */
  value?: number;
}
export interface SplitResult {
  userId: string;
  amountCents: number;
}

export class SplitError extends Error {}

/** Parse "33.5" -> 3350 basis points. Max 2 decimals. */
export function parsePercentToBp(input: string): number {
  const s = input.trim().replace(/%$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new SplitError('Percentages can have at most 2 decimal places');
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number(f.padEnd(2, '0'));
}

/**
 * Largest-remainder apportionment: floor(total*weight/sumWeights) each, then hand
 * leftover units to the largest fractional remainders (ties -> earlier participant).
 */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const base = weights.map((w) => Math.floor((total * w) / sum));
  const rem = weights.map((w, i) => ({ i, r: (total * w) % sum }));
  let left = total - base.reduce((a, b) => a + b, 0);
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % rem.length, left--) base[rem[k].i] += 1;
  return base;
}

function nonNegInt(v: number | undefined, msg: string): number {
  if (v === undefined || !Number.isSafeInteger(v) || v < 0) throw new SplitError(msg);
  return v;
}

export function computeSplits(total: number, method: SplitMethod, participants: SplitInput[]): SplitResult[] {
  if (!Number.isSafeInteger(total) || total <= 0) throw new SplitError('Amount must be greater than zero');
  if (participants.length === 0) throw new SplitError('Choose at least one person to split with');
  const ids = participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) throw new SplitError('A person appears more than once in the split');

  let amounts: number[];
  switch (method) {
    case 'equal': {
      const n = participants.length;
      const base = Math.floor(total / n);
      const extra = total - base * n; // leftover cents go to the LAST `extra` people
      amounts = participants.map((_, i) => base + (i >= n - extra ? 1 : 0));
      break;
    }
    case 'custom': {
      amounts = participants.map((p) => nonNegInt(p.value, 'Custom amounts must be zero or more'));
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum !== total) throw new SplitError(`Custom amounts must add up to the total (off by ${total - sum} minor units)`);
      break;
    }
    case 'percent': {
      const bps = participants.map((p) => nonNegInt(p.value, 'Percentages must be zero or more'));
      if (bps.reduce((a, b) => a + b, 0) !== 10000) throw new SplitError('Percentages must add up to exactly 100%');
      amounts = apportion(total, bps);
      break;
    }
    case 'shares': {
      const w = participants.map((p) => {
        const v = nonNegInt(p.value, 'Shares must be whole numbers greater than zero');
        if (v === 0) throw new SplitError('Shares must be whole numbers greater than zero');
        return v;
      });
      amounts = apportion(total, w);
      break;
    }
    default:
      throw new SplitError('Unknown split method');
  }
  const result = participants.map((p, i) => ({ userId: p.userId, amountCents: amounts[i] }));
  if (result.reduce((a, r) => a + r.amountCents, 0) !== total) throw new SplitError('Internal split error');
  return result;
}
