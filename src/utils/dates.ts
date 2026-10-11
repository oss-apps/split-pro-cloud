import { format } from 'date-fns';

// Dates are shown in the device's language and time zone. Pass `locale` only in tests.

const isSameYear = (date: Date, now: Date) => date.getFullYear() === now.getFullYear();

/** Whether a list sorted by date starts a new month at `date`. */
export const isNewMonth = (date: Date, previous: Date | undefined) =>
  !previous ||
  date.getFullYear() !== previous.getFullYear() ||
  date.getMonth() !== previous.getMonth();

/** "October", or "October 2025" outside the current year. */
export const formatMonthHeader = (date: Date, now = new Date(), locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    month: 'long',
    ...(isSameYear(date, now) ? {} : { year: 'numeric' }),
  }).format(date);

/** "11 Oct" (or "Oct 11", per locale), with the year outside the current year. */
export const formatShortDate = (date: Date, now = new Date(), locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(isSameYear(date, now) ? {} : { year: 'numeric' }),
  }).format(date);

/** Month and day as two short parts, for the date column of expense lists. */
export const getDateColumn = (date: Date, locale?: string) => ({
  month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
  day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date),
});

/** A local `yyyy-MM-dd`, the value of a date input. */
export const toDateInputValue = (date: Date) => format(date, 'yyyy-MM-dd');

/**
 * The day picked in a date input. Today (or nothing valid) gives undefined, so the server records
 * the current time as for any new expense.
 */
export const parseDateInput = (value: string, now = new Date()) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || value === toDateInputValue(now)) {
    return undefined;
  }

  // Noon keeps the same calendar day for friends a few time zones away.
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) || date > now ? undefined : date;
};
