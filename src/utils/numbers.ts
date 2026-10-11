// Amounts are stored as 32-bit integer cents.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export const AMOUNT_TOO_LARGE_MESSAGE = `This amount is too large. Amounts and balances can be at most ${(
  MAX_AMOUNT_CENTS / 100
).toLocaleString('en-US', { minimumFractionDigits: 2 })}.`;

export function toFixedNumber(num: number) {
  return num / 100;
}

export function toInteger(num: number) {
  return Math.round(num * 100);
}

/**
 * A sum of percentages or shares in whole hundredths. Values with at most 2 decimals add up exactly,
 * whatever float noise their sum has.
 */
export function sumHundredths(values: number[]) {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100);
}

/** Whether a value is written with at most 2 decimals, e.g. 33.33 but not 33.333. */
export function hasAtMostTwoDecimals(value: number) {
  return Number.isFinite(value) && Math.round(value * 100) / 100 === value;
}

/** Whether a major-unit amount (e.g. 12.34) fits the stored integer cents. */
export function isAmountWithinLimit(num: number) {
  const cents = toInteger(num);
  return Number.isFinite(cents) && Math.abs(cents) <= MAX_AMOUNT_CENTS;
}

export function toUIString(num: number) {
  return toFixedNumber(Math.abs(num)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Like `toUIString`, but keeps the minus sign of negative amounts. */
export function toSignedUIString(num: number) {
  return `${0 > num ? '-' : ''}${toUIString(num)}`;
}
