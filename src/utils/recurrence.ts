import { RecurringFrequency } from '@prisma/client';
import { z } from 'zod';

/**
 * A calendar date in a time zone, without a time. Stored in `@db.Date` columns, which Prisma
 * reads as UTC midnight.
 */
export type LocalDate = { year: number; month: number; day: number };

export const RECURRING_FREQUENCIES = [
  RecurringFrequency.DAILY,
  RecurringFrequency.WEEKLY,
  RecurringFrequency.MONTHLY,
  RecurringFrequency.LAST_DAY_OF_MONTH,
  RecurringFrequency.YEARLY,
] as const;

export const FREQUENCY_LABELS = {
  [RecurringFrequency.DAILY]: 'Every day',
  [RecurringFrequency.WEEKLY]: 'Every week',
  [RecurringFrequency.MONTHLY]: 'Every month',
  [RecurringFrequency.LAST_DAY_OF_MONTH]: 'Last day of every month',
  [RecurringFrequency.YEARLY]: 'Every year',
} satisfies Record<RecurringFrequency, string>;

export const SHORT_FREQUENCY_LABELS = {
  [RecurringFrequency.DAILY]: 'Daily',
  [RecurringFrequency.WEEKLY]: 'Weekly',
  [RecurringFrequency.MONTHLY]: 'Monthly',
  [RecurringFrequency.LAST_DAY_OF_MONTH]: 'Month end',
  [RecurringFrequency.YEARLY]: 'Yearly',
} satisfies Record<RecurringFrequency, string>;

const DAY_MS = 24 * 60 * 60 * 1000;

export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const toDbDate = (date: LocalDate) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day));

export const fromDbDate = (date: Date): LocalDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

export const compareLocalDates = (a: LocalDate, b: LocalDate) =>
  toDbDate(a).getTime() - toDbDate(b).getTime();

export const formatLocalDate = (date: LocalDate) =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

export const addDays = (date: LocalDate, days: number) =>
  fromDbDate(new Date(toDbDate(date).getTime() + days * DAY_MS));

/** The month `months` after the given one, on `day` or the month's last day if it is shorter. */
const addMonths = (date: LocalDate, months: number, day: number) => {
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
};

/**
 * The `index`th date of a schedule. Dates stay anchored to the start, so a schedule from the 31st
 * goes 31 Jan, 28 Feb, 31 Mar, and one from 29 Feb lands on 28 Feb outside leap years.
 */
export const getScheduledDate = (
  frequency: RecurringFrequency,
  start: LocalDate,
  index: number,
): LocalDate => {
  switch (frequency) {
    case RecurringFrequency.DAILY:
      return addDays(start, index);
    case RecurringFrequency.WEEKLY:
      return addDays(start, 7 * index);
    case RecurringFrequency.MONTHLY:
      return addMonths(start, index, start.day);
    case RecurringFrequency.LAST_DAY_OF_MONTH:
      return addMonths(start, index, 31);
    case RecurringFrequency.YEARLY:
      return addMonths(start, 12 * index, start.day);
  }
};

/** Roughly how many schedule dates lie between `start` and `date`, never more than there are. */
const estimateIndex = (frequency: RecurringFrequency, start: LocalDate, date: LocalDate) => {
  const days = Math.floor((toDbDate(date).getTime() - toDbDate(start).getTime()) / DAY_MS);
  const months = (date.year - start.year) * 12 + date.month - start.month;
  switch (frequency) {
    case RecurringFrequency.DAILY:
      return days;
    case RecurringFrequency.WEEKLY:
      return Math.floor(days / 7);
    case RecurringFrequency.MONTHLY:
    case RecurringFrequency.LAST_DAY_OF_MONTH:
      return months - 1;
    case RecurringFrequency.YEARLY:
      return Math.floor(months / 12) - 1;
  }
};

/** The first date of the schedule after `date`. */
export const getOccurrenceAfter = (
  frequency: RecurringFrequency,
  start: LocalDate,
  date: LocalDate,
): LocalDate => {
  let index = Math.max(0, estimateIndex(frequency, start, date));
  let candidate = getScheduledDate(frequency, start, index);
  while (0 >= compareLocalDates(candidate, date)) {
    index += 1;
    candidate = getScheduledDate(frequency, start, index);
  }
  return candidate;
};

/**
 * The next date of a schedule after `after` (e.g. the latest occurrence) that is not before
 * `today`. Dates missed while a rule was paused, or before it was set up, are never added.
 */
export const getNextOccurrence = (
  frequency: RecurringFrequency,
  start: LocalDate,
  after: LocalDate,
  today: LocalDate,
) => {
  const yesterday = addDays(today, -1);
  return getOccurrenceAfter(
    frequency,
    start,
    0 <= compareLocalDates(after, yesterday) ? after : yesterday,
  );
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const getFormatter = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/**
 * The time zone's canonical name, e.g. "Europe/Berlin" for "europe/berlin", or undefined if it is
 * unknown. Only canonical names are stored and cached, so client input can't grow the cache.
 */
export const getCanonicalTimeZone = (timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export const isValidTimeZone = (timeZone: string) => undefined !== getCanonicalTimeZone(timeZone);

/** How an expense repeats, as sent by the app. The time zone is stored by its canonical name. */
export const recurrenceInputSchema = z.object({
  frequency: z.enum(RECURRING_FREQUENCIES),
  timezone: z
    .string()
    .max(100)
    .transform((timeZone, ctx) => {
      const canonical = getCanonicalTimeZone(timeZone);
      if (!canonical) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unknown time zone' });
        return z.NEVER;
      }
      return canonical;
    }),
});

/** The wall clock in `timeZone` at an instant, as if it were UTC. */
const getWallTime = (instant: number, timeZone: string) => {
  const parts = Object.fromEntries(
    getFormatter(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
};

const getOffset = (instant: number, timeZone: string) =>
  getWallTime(instant - (instant % 1000), timeZone) - (instant - (instant % 1000));

/** The calendar date at an instant in `timeZone`. */
export const getLocalDate = (instant: Date, timeZone: string): LocalDate =>
  fromDbDate(new Date(getWallTime(instant.getTime(), timeZone)));

/**
 * The first instant at which the wall clock in `timeZone` shows `hour`:00 on `date`. When that
 * time is skipped by a clock change (e.g. midnight in Santiago when summer time starts), it is the
 * moment of the change, the first instant of that day at or after `hour`:00.
 */
export const getZonedTime = (date: LocalDate, hour: number, timeZone: string) => {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour);
  const offsets = [...new Set([-DAY_MS, 0, DAY_MS].map((d) => getOffset(wall + d, timeZone)))];
  const exact = offsets
    .map((offset) => wall - offset)
    .filter((instant) => getWallTime(instant, timeZone) === wall)
    .sort((a, b) => a - b)[0];
  if (undefined !== exact) {
    return new Date(exact);
  }

  // Skipped: find the change between the latest instant before and the first one after.
  let before = wall - Math.max(...offsets);
  let after = wall - Math.min(...offsets);
  while (1000 < after - before) {
    const middle = before + Math.floor((after - before) / 2);
    if (getWallTime(middle, timeZone) >= wall) {
      after = middle;
    } else {
      before = middle;
    }
  }
  return new Date(after - (after % 1000));
};

/** When an occurrence on `date` is due: the start of that day in the rule's time zone. */
export const getDueAt = (date: LocalDate, timeZone: string) => getZonedTime(date, 0, timeZone);

/** The date an occurrence is recorded with: noon, so it stays on that day a few zones away. */
export const getOccurrenceExpenseDate = (date: LocalDate, timeZone: string) =>
  getZonedTime(date, 12, timeZone);

/** After downtime, at most this many missed occurrences of a rule are added. */
export const MAX_CATCH_UP_OCCURRENCES = 3;

/**
 * The dates due by `now`, from the rule's next date on. Only the latest few are kept, older ones
 * are skipped (and counted).
 */
export const getDueDates = (
  frequency: RecurringFrequency,
  start: LocalDate,
  next: LocalDate,
  timeZone: string,
  now: Date,
) => {
  const due: LocalDate[] = [];
  let skipped = 0;
  for (let date = next; getDueAt(date, timeZone) <= now; ) {
    due.push(date);
    if (MAX_CATCH_UP_OCCURRENCES < due.length) {
      due.shift();
      skipped += 1;
    }
    date = getOccurrenceAfter(frequency, start, date);
  }
  return { due, skipped };
};

const ordinal = (day: number) => {
  const tens = day % 100;
  if (11 <= tens && 13 >= tens) {
    return `${day}th`;
  }
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** E.g. "Every month on the 31st", "Every week on Monday". */
export const describeSchedule = (frequency: RecurringFrequency, start: LocalDate) => {
  switch (frequency) {
    case RecurringFrequency.DAILY:
    case RecurringFrequency.LAST_DAY_OF_MONTH:
      return FREQUENCY_LABELS[frequency];
    case RecurringFrequency.WEEKLY:
      return `Every week on ${WEEKDAYS[toDbDate(start).getUTCDay()]}`;
    case RecurringFrequency.MONTHLY:
      return `Every month on the ${ordinal(start.day)}`;
    case RecurringFrequency.YEARLY:
      return `Every year on ${MONTHS[start.month - 1]} ${start.day}`;
  }
};

/** E.g. "30 Nov 2026". */
export const formatScheduleDate = (date: LocalDate) =>
  `${date.day} ${MONTHS[date.month - 1]?.slice(0, 3)} ${date.year}`;
