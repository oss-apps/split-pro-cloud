import { addDays, endOfMonth, isSameDay, startOfMonth, startOfWeek } from 'date-fns';

/**
 * The days of a month view, a week per row from Sunday, with `null` for days outside the month.
 * `month` is 0-based, like `Date`.
 */
export const getMonthWeeks = (year: number, month: number): (Date | null)[][] => {
  const first = startOfMonth(new Date(year, month, 1));
  const last = endOfMonth(first);
  const weekCount = Math.ceil((first.getDay() + last.getDate()) / 7);
  const start = startOfWeek(first);

  return Array.from({ length: weekCount }, (_, week) =>
    Array.from({ length: 7 }, (__, weekday) => {
      const day = addDays(start, week * 7 + weekday);
      return day.getMonth() === month ? day : null;
    }),
  );
};

/** The month before or after, as `{ year, month }` with a 0-based month. */
export const shiftMonth = (year: number, month: number, by: number) => {
  const index = year * 12 + month + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
};

/** Without a date the expense is saved for today, so no date reads as today too. */
export const isTodayOrUnset = (date: Date | undefined, today: Date) =>
  !date || isSameDay(date, today);
