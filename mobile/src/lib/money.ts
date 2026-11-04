/**
 * Money on the server is an integer number of cents (the currency's minor unit), typed `number`.
 * Never do float math on amounts: keep cents end to end and use these helpers, which wrap the web's
 * ../src/utils/numbers.ts so both apps format and parse the same way.
 */
import { CURRENCIES } from '~/lib/currency';
import { isAmountWithinLimit, toInteger, toSignedUIString, toUIString } from '~/utils/numbers';

export type Currency = (typeof CURRENCIES)[number];

export const getCurrency = (code: string): Currency | undefined => {
  const upper = code.toUpperCase();
  return CURRENCIES.find((currency) => upper === currency.code);
};

/** `formatMoney(1234, 'usd')` → `USD 12.34`, the web's format. Drops the sign. */
export const formatMoney = (cents: number, currency: string) =>
  `${currency.toUpperCase()} ${toUIString(cents)}`;

/** Like `formatMoney`, but keeps the minus sign of negative amounts. */
export const formatSignedMoney = (cents: number, currency: string) =>
  `${currency.toUpperCase()} ${toSignedUIString(cents)}`;

/**
 * Parses what the user typed (e.g. `12.5` or `12,50`) into cents. Returns `null` for anything that
 * isn't a positive amount the server can store.
 */
export const parseMoneyInput = (text: string): number | null => {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');

  if (!/^\d*\.?\d{0,2}$/.test(normalized) || '' === normalized || '.' === normalized) {
    return null;
  }

  const value = Number(normalized);

  if (!Number.isFinite(value) || 0 >= value || !isAmountWithinLimit(value)) {
    return null;
  }

  return toInteger(value);
};
