import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type Group,
  RecurringFrequency,
  type RecurringStatus,
  SplitType,
  type User,
} from '@prisma/client';

import {
  getEditFormState,
  getRecurrenceToSave,
  matchesEditSnapshot,
  useAddExpenseStore,
} from '~/store/addStore';
import {
  type LocalDate,
  MAX_CATCH_UP_OCCURRENCES,
  describeSchedule,
  formatLocalDate,
  getDueAt,
  getDueDates,
  getLocalDate,
  getNextOccurrence,
  getOccurrenceAfter,
  getOccurrenceExpenseDate,
  getCanonicalTimeZone,
  isValidTimeZone,
  recurrenceInputSchema,
} from '~/utils/recurrence';

const d = (value: string): LocalDate => {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
};

/** The first `count` dates of a schedule after its start. */
const dates = (frequency: RecurringFrequency, start: string, count: number) => {
  const result: string[] = [];
  let date = d(start);
  for (let i = 0; i < count; i++) {
    date = getOccurrenceAfter(frequency, d(start), date);
    result.push(formatLocalDate(date));
  }
  return result;
};

void describe('schedules', () => {
  void it('repeats daily and weekly', () => {
    assert.deepEqual(dates(RecurringFrequency.DAILY, '2026-02-27', 3), [
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    assert.deepEqual(dates(RecurringFrequency.WEEKLY, '2026-12-24', 2), [
      '2026-12-31',
      '2027-01-07',
    ]);
  });

  void it('keeps a monthly 31st on the last day of shorter months and comes back to the 31st', () => {
    assert.deepEqual(dates(RecurringFrequency.MONTHLY, '2026-01-31', 4), [
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    assert.deepEqual(dates(RecurringFrequency.MONTHLY, '2027-12-30', 3), [
      '2028-01-30',
      '2028-02-29',
      '2028-03-30',
    ]);
  });

  void it('goes to the last day of every month, from any day', () => {
    assert.deepEqual(dates(RecurringFrequency.LAST_DAY_OF_MONTH, '2027-01-15', 4), [
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    assert.deepEqual(dates(RecurringFrequency.LAST_DAY_OF_MONTH, '2028-01-31', 2), [
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  void it('repeats 29 February on the 28th outside leap years', () => {
    assert.deepEqual(dates(RecurringFrequency.YEARLY, '2028-02-29', 5), [
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
      '2033-02-28',
    ]);
  });

  void it('finds the next date from far after the start without drifting', () => {
    assert.equal(
      formatLocalDate(
        getOccurrenceAfter(RecurringFrequency.MONTHLY, d('2020-01-31'), d('2031-02-28')),
      ),
      '2031-03-31',
    );
    assert.equal(
      formatLocalDate(
        getOccurrenceAfter(RecurringFrequency.DAILY, d('2020-01-01'), d('2026-10-11')),
      ),
      '2026-10-12',
    );
  });

  void it('starts after the latest occurrence and never before today', () => {
    const next = (after: string, today: string) =>
      formatLocalDate(
        getNextOccurrence(RecurringFrequency.MONTHLY, d('2026-01-31'), d(after), d(today)),
      );
    assert.equal(next('2026-01-31', '2026-01-31'), '2026-02-28');
    // Paused for months: the missed dates are not added, today's is.
    assert.equal(next('2026-02-28', '2026-06-30'), '2026-06-30');
    assert.equal(next('2026-02-28', '2026-07-01'), '2026-07-31');
  });

  void it('describes a schedule', () => {
    assert.equal(describeSchedule('MONTHLY', d('2026-01-31')), 'Every month on the 31st');
    assert.equal(describeSchedule('MONTHLY', d('2026-01-12')), 'Every month on the 12th');
    assert.equal(describeSchedule('MONTHLY', d('2026-01-22')), 'Every month on the 22nd');
    assert.equal(describeSchedule('WEEKLY', d('2026-10-12')), 'Every week on Monday');
    assert.equal(describeSchedule('YEARLY', d('2028-02-29')), 'Every year on February 29');
  });
});

void describe('time zones', () => {
  const dueTimes = (timeZone: string, days: string[]) =>
    days.map((day) => getDueAt(d(day), timeZone).toISOString());

  void it('starts each day at local midnight across daylight saving changes', () => {
    assert.deepEqual(
      dueTimes('America/New_York', [
        '2026-03-07',
        '2026-03-08',
        '2026-03-09',
        '2026-11-01',
        '2026-11-02',
      ]),
      [
        '2026-03-07T05:00:00.000Z',
        '2026-03-08T05:00:00.000Z',
        '2026-03-09T04:00:00.000Z',
        '2026-11-01T04:00:00.000Z',
        '2026-11-02T05:00:00.000Z',
      ],
    );
    assert.deepEqual(
      dueTimes('Europe/London', ['2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26']),
      [
        '2026-03-29T00:00:00.000Z',
        '2026-03-29T23:00:00.000Z',
        '2026-10-24T23:00:00.000Z',
        '2026-10-26T00:00:00.000Z',
      ],
    );
    assert.deepEqual(
      dueTimes('Australia/Sydney', ['2026-04-05', '2026-04-06', '2026-10-04', '2026-10-05']),
      [
        '2026-04-04T13:00:00.000Z',
        '2026-04-05T14:00:00.000Z',
        '2026-10-03T14:00:00.000Z',
        '2026-10-04T13:00:00.000Z',
      ],
    );
    assert.deepEqual(dueTimes('Asia/Kolkata', ['2026-03-08']), ['2026-03-07T18:30:00.000Z']);
  });

  void it('starts a day whose midnight is skipped at the clock change', () => {
    // Santiago moves from 00:00 to 01:00 on 6 Sep 2026, and from 00:00 back to 23:00 on 5 Apr.
    assert.deepEqual(dueTimes('America/Santiago', ['2026-09-05', '2026-09-06', '2026-09-07']), [
      '2026-09-05T04:00:00.000Z',
      '2026-09-06T04:00:00.000Z',
      '2026-09-07T03:00:00.000Z',
    ]);
    assert.deepEqual(dueTimes('America/Santiago', ['2026-04-04', '2026-04-05']), [
      '2026-04-04T03:00:00.000Z',
      '2026-04-05T04:00:00.000Z',
    ]);
  });

  void it('records each occurrence on its own date, wherever its day starts', () => {
    const zones = ['America/New_York', 'Europe/London', 'Australia/Sydney', 'America/Santiago'];
    zones.forEach((timeZone) => {
      let date = d('2026-01-01');
      for (let i = 0; i < 400; i++) {
        assert.deepEqual(getLocalDate(getDueAt(date, timeZone), timeZone), date, timeZone);
        assert.deepEqual(
          getLocalDate(getOccurrenceExpenseDate(date, timeZone), timeZone),
          date,
          timeZone,
        );
        // A day never starts before the previous one.
        const next = getOccurrenceAfter(RecurringFrequency.DAILY, d('2026-01-01'), date);
        assert.ok(getDueAt(next, timeZone) > getDueAt(date, timeZone));
        date = next;
      }
    });
  });

  void it('takes IANA time zones only', () => {
    assert.equal(isValidTimeZone('Europe/Berlin'), true);
    assert.equal(isValidTimeZone('UTC'), true);
    assert.equal(isValidTimeZone('Mars/Olympus'), false);
    assert.equal(isValidTimeZone('0 0 * * *'), false);
  });
});

void describe('getDueDates', () => {
  const due = (next: string, now: string) =>
    getDueDates(RecurringFrequency.DAILY, d('2026-01-01'), d(next), 'UTC', new Date(now));

  void it('is nothing before the day starts', () => {
    assert.deepEqual(due('2026-10-11', '2026-10-10T23:59:59Z'), { due: [], skipped: 0 });
  });

  void it(`catches up at most ${MAX_CATCH_UP_OCCURRENCES} missed dates, the latest ones`, () => {
    const result = due('2026-10-01', '2026-10-11T08:00:00Z');
    assert.deepEqual(result.due.map(formatLocalDate), ['2026-10-09', '2026-10-10', '2026-10-11']);
    assert.equal(result.skipped, 8);
    assert.deepEqual(due('2026-10-10', '2026-10-11T08:00:00Z').due.map(formatLocalDate), [
      '2026-10-10',
      '2026-10-11',
    ]);
  });
});

void describe('repeat in the add form', () => {
  const me: User = {
    id: 1,
    name: 'Me',
    email: 'me@example.com',
    emailVerified: null,
    deletedAt: null,
    image: null,
    currency: 'USD',
  };
  const alex: User = { ...me, id: 2, name: 'Alex', email: 'alex@example.com' };
  const trip = {
    id: 1,
    name: 'Trip',
    defaultCurrency: 'EUR',
    defaultSplitType: SplitType.PERCENTAGE,
    defaultSplitShares: { 1: 60, 2: 40 },
  } as unknown as Group;
  const state = () => useAddExpenseStore.getState();
  const start = () => {
    useAddExpenseStore.setState({ currentUser: me, preferredCurrency: 'USD' });
    state().actions.resetState();
  };
  const expense = (recurring?: { frequency: RecurringFrequency; status: RecurringStatus }) => ({
    amount: 10_000,
    splitType: SplitType.EXACT,
    category: 'general',
    currency: 'USD',
    name: 'Rent',
    expenseDate: new Date(2026, 9, 1, 12),
    fileKey: null,
    group: trip,
    paidByUser: me,
    expenseParticipants: [
      { amount: 6_667, user: me },
      { amount: -6_667, user: alex },
    ],
    recurring,
  });

  void it('saves a repeat only when one is picked, and never for a payment', () => {
    start();
    assert.equal(getRecurrenceToSave(state(), 'UTC'), undefined);
    state().actions.setRecurrence(RecurringFrequency.MONTHLY);
    assert.deepEqual(getRecurrenceToSave(state(), 'Europe/Berlin'), {
      frequency: 'MONTHLY',
      timezone: 'Europe/Berlin',
    });
    useAddExpenseStore.setState({ splitType: SplitType.SETTLEMENT });
    assert.equal(getRecurrenceToSave(state(), 'UTC'), undefined);
  });

  void it('is cleared for the next form', () => {
    start();
    state().actions.setRecurrence(RecurringFrequency.WEEKLY);
    state().actions.resetState();
    assert.equal(state().recurrence, null);
    assert.equal(state().loadedRecurrence, undefined);
  });

  void it('changes an edit only when the repeat was changed', () => {
    start();
    useAddExpenseStore.setState(
      getEditFormState(expense({ frequency: 'MONTHLY', status: 'PAUSED' })),
    );
    assert.equal(state().recurrence, RecurringFrequency.MONTHLY);
    assert.equal(getRecurrenceToSave(state(), 'UTC'), undefined);

    state().actions.setRecurrence(RecurringFrequency.YEARLY);
    assert.deepEqual(getRecurrenceToSave(state(), 'UTC'), { frequency: 'YEARLY', timezone: 'UTC' });
    state().actions.setRecurrence(null);
    assert.equal(getRecurrenceToSave(state(), 'UTC'), null);
    state().actions.setRecurrence(RecurringFrequency.MONTHLY);
    assert.equal(getRecurrenceToSave(state(), 'UTC'), undefined);
  });

  void it('shows a stopped series as not repeating, and leaves it alone unless repeated again', () => {
    start();
    useAddExpenseStore.setState(
      getEditFormState(expense({ frequency: 'MONTHLY', status: 'STOPPED' })),
    );
    assert.equal(state().recurrence, null);
    assert.equal(getRecurrenceToSave(state(), 'UTC'), undefined);
  });

  void it('keeps the stored cents, currency and split of an edit', () => {
    start();
    useAddExpenseStore.setState(
      getEditFormState(expense({ frequency: 'MONTHLY', status: 'ACTIVE' })),
    );
    const before = state();
    state().actions.setRecurrence(RecurringFrequency.WEEKLY);
    state().actions.setRecurrence(null);
    assert.equal(matchesEditSnapshot(state()), true);
    assert.equal(state().editSnapshot, before.editSnapshot);
    assert.equal(state().participants, before.participants);
    assert.equal(state().currencyTouched, true);
    assert.equal(state().splitTouched, true);
  });

  void it('stays as picked when the group changes, without touching the split or currency', () => {
    start();
    state().actions.setRecurrence(RecurringFrequency.MONTHLY);
    state().actions.setAmount(100);
    state().actions.selectGroup(trip, [me, alex]);
    assert.equal(state().recurrence, RecurringFrequency.MONTHLY);
    assert.equal(state().currency, 'EUR');
    assert.equal(state().splitType, SplitType.PERCENTAGE);
    assert.equal(state().splitTouched, false);
    assert.deepEqual(
      state().participants.map((p) => p.amount),
      [40, -40],
    );
  });
});

void describe('time zone input', () => {
  void it('stores the canonical name and rejects unknown zones', () => {
    assert.equal(getCanonicalTimeZone('europe/berlin'), 'Europe/Berlin');
    assert.equal(getCanonicalTimeZone('EUROPE/BERLIN'), 'Europe/Berlin');
    assert.equal(getCanonicalTimeZone('Mars/Olympus'), undefined);
    assert.deepEqual(
      recurrenceInputSchema.parse({
        frequency: RecurringFrequency.MONTHLY,
        timezone: 'eUrOpE/bErLiN',
      }),
      { frequency: RecurringFrequency.MONTHLY, timezone: 'Europe/Berlin' },
    );
    assert.equal(
      recurrenceInputSchema.safeParse({
        frequency: RecurringFrequency.MONTHLY,
        timezone: 'Mars/Olympus',
      }).success,
      false,
    );
  });
});
