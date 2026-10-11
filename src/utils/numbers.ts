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
