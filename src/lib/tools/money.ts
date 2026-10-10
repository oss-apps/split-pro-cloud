/**
 * Money helpers for the public calculators. Amounts are integers in the currency's minor unit
 * (cents for USD, yen for JPY), so every split adds back up to the exact total.
 */

const fractionDigitsCache = new Map<string, number>();

export const fractionDigits = (currency: string) => {
  const cached = fractionDigitsCache.get(currency);
  if (undefined !== cached) {
    return cached;
  }
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
};

export const minorUnitFactor = (currency: string) => 10 ** fractionDigits(currency);

/** Parses user input like "1,234.50" or "12" into minor units. Invalid input is 0. */
export const parseAmount = (value: string, currency: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const normalized = cleaned.replace(',', '.');
  const number = Number.parseFloat(normalized);
  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }
  return Math.round(number * minorUnitFactor(currency));
};

export const formatMoney = (minor: number, currency: string) => {
  const factor = minorUnitFactor(currency);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits(currency),
    }).format(minor / factor);
  } catch {
    return `${currency} ${(minor / factor).toFixed(2)}`;
  }
};

/**
 * Splits `total` into integer parts proportional to `weights` using the largest remainder method,
 * so the parts always sum to `total`. With no positive weights, it splits equally.
 */
export const allocate = (total: number, weights: readonly number[]) => {
  if (0 === weights.length) {
    return [];
  }
  const positive = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = positive.reduce((acc, weight) => acc + weight, 0);
  const effective = 0 === sum ? positive.map(() => 1) : positive;
  const effectiveSum = 0 === sum ? effective.length : sum;

  const exact = effective.map((weight) => (total * weight) / effectiveSum);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = total - parts.reduce((acc, part) => acc + part, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remainder <= 0) {
      break;
    }
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }

  return parts;
};

/** Minor units back to a plain number for an input field, like 12345 → "123.45". */
export const toInputAmount = (minor: number, currency: string) => {
  if (!minor) {
    return '';
  }
  const digits = fractionDigits(currency);
  const fixed = (minor / 10 ** digits).toFixed(digits);
  return digits ? fixed.replace(/\.?0+$/, '') : fixed;
};

export const currencySymbol = (currency: string) => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
        .formatToParts(0)
        .find((part) => 'currency' === part.type)?.value ?? currency
    );
  } catch {
    return currency;
  }
};
