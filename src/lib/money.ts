/**
 * Money is ALWAYS an integer count of minor units (cents for USD, yen for JPY).
 * Floating point is never used for arithmetic; decimals only appear when
 * parsing user text and when formatting for display.
 */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'JPY', 'AUD'] as const;

/** Minor-unit exponent per currency. Unlisted currencies default to 2. */
const EXPONENTS: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, BHD: 3, KWD: 3 };

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export const MAX_MINOR_UNITS = 100_000_000_000_00; // far inside 2^53

export class MoneyError extends Error {}

/** Parse "12", "12.5", "1,234.56", "$12.50" to minor units. Rejects junk, negatives, excess precision. */
export function parseMoney(input: string, currency = 'USD'): number {
  const exp = currencyExponent(currency);
  const cleaned = input.trim().replace(/^[^\d.\-+]+/, '').replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    throw new MoneyError('Enter a valid amount, for example 25.00');
  }
  const [whole, frac = ''] = cleaned.split('.');
  if (frac.length > exp) {
    throw new MoneyError(
      exp === 0 ? `${currency} amounts cannot have decimals` : `Use at most ${exp} decimal places`,
    );
  }
  const minor = Number(whole || '0') * 10 ** exp + Number(frac.padEnd(exp, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR_UNITS) throw new MoneyError('Amount is too large');
  return minor;
}

export function formatMoney(minor: number, currency = 'USD', locale?: string): string {
  const exp = currencyExponent(currency);
  const sign = minor < 0 ? -1 : 1;
  const abs = Math.abs(minor);
  // Build the decimal from integers; Intl is used only for symbol/grouping (display only).
  const whole = Math.floor(abs / 10 ** exp);
  const frac = String(abs % 10 ** exp).padStart(exp, '0');
  const numeric = Number(exp ? `${whole}.${frac}` : `${whole}`) * sign;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(exp)} ${currency}`;
  }
}

/** Minor units -> plain decimal string for form inputs ("25.00"). */
export function minorToInput(minor: number, currency = 'USD'): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const abs = Math.abs(minor);
  return `${minor < 0 ? '-' : ''}${Math.floor(abs / 10 ** exp)}.${String(abs % 10 ** exp).padStart(exp, '0')}`;
}

export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}
