import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Group, SplitType, type User } from '@prisma/client';

import { addRecentCurrency, MAX_RECENT_CURRENCIES } from '~/hooks/useRecentCurrencies';
import { getEditFormState, useAddExpenseStore } from '~/store/addStore';
import { hasShareWithFriend } from '~/utils/expenseLabels';
import {
  formatMonthHeader,
  formatShortDate,
  getDateColumn,
  isNewMonth,
  parseDateInput,
  toDateInputValue,
} from '~/utils/dates';
import { buildSettleUpPayment, getSettleUpDestinations } from '~/utils/settleUp';

const me: User = {
  id: 1,
  name: 'Me',
  email: 'me@example.com',
  emailVerified: null,
  deletedAt: null,
  image: null,
  currency: 'INR',
};

const group = (id: number, defaultCurrency: string) =>
  ({ id, name: `Group ${id}`, defaultCurrency }) as Group;

void describe('expense list dates', () => {
  const now = new Date(2026, 9, 11, 15);

  void it('starts a new month on the first row and when the month or year changes', () => {
    assert.equal(isNewMonth(new Date(2026, 9, 11), undefined), true);
    assert.equal(isNewMonth(new Date(2026, 9, 1), new Date(2026, 9, 30)), false);
    assert.equal(isNewMonth(new Date(2026, 8, 30), new Date(2026, 9, 1)), true);
    assert.equal(isNewMonth(new Date(2025, 9, 30), new Date(2026, 9, 1)), true);
  });

  void it('shows the year only outside the current year', () => {
    assert.equal(formatMonthHeader(new Date(2026, 2, 3), now, 'en-US'), 'March');
    assert.equal(formatMonthHeader(new Date(2025, 11, 3), now, 'en-US'), 'December 2025');
    assert.equal(formatShortDate(new Date(2026, 2, 3), now, 'en-GB'), '3 Mar');
    assert.equal(formatShortDate(new Date(2025, 11, 3), now, 'en-GB'), '3 Dec 2025');
  });

  void it('orders the date column like the locale', () => {
    assert.deepEqual(getDateColumn(new Date(2026, 2, 3), 'en-US'), ['Mar', '3']);
    assert.deepEqual(getDateColumn(new Date(2026, 2, 3), 'en-GB'), ['3', 'Mar']);
  });
});

void describe('parseDateInput', () => {
  const now = new Date(2026, 9, 11, 15);

  void it('records today and anything invalid as now', () => {
    assert.equal(parseDateInput('', now), undefined);
    assert.equal(parseDateInput(toDateInputValue(now), now), undefined);
    assert.equal(parseDateInput('11/10/2026', now), undefined);
  });

  void it('dates an earlier day at local noon', () => {
    assert.deepEqual(parseDateInput('2026-09-30', now), new Date(2026, 8, 30, 12));
  });

  void it('never dates a payment in the future', () => {
    assert.equal(parseDateInput('2026-10-12', now), undefined);
  });
});

void describe('addRecentCurrency', () => {
  void it('moves the currency to the front without duplicates', () => {
    assert.deepEqual(addRecentCurrency(['USD', 'EUR', 'INR'], 'INR'), ['INR', 'USD', 'EUR']);
  });

  void it('keeps only the latest few', () => {
    const recent = ['USD', 'EUR', 'INR', 'GBP', 'CAD'];
    assert.equal(recent.length, MAX_RECENT_CURRENCIES);
    assert.deepEqual(addRecentCurrency(recent, 'AUD'), ['AUD', 'USD', 'EUR', 'INR', 'GBP']);
  });

  void it('ignores unknown codes', () => {
    assert.deepEqual(addRecentCurrency(['USD'], 'XYZ'), ['USD']);
  });
});

void describe('group currency in the add flow', () => {
  const friend: User = { ...me, id: 2, name: 'Friend', email: 'friend@example.com' };
  const trip = group(1, 'EUR');
  const start = () => {
    useAddExpenseStore.setState({ currentUser: me, preferredCurrency: 'INR' });
    useAddExpenseStore.getState().actions.resetState();
  };
  const state = () => useAddExpenseStore.getState();
  // As in the form: picking a currency also makes it the user's default.
  const pickCurrency = (currency: string) => {
    state().actions.setCurrency(currency);
    state().actions.setPreferredCurrency(currency);
  };
  // As UserInput (Backspace) and SelectUserOrGroup do.
  const removeGroup = () => {
    state().actions.setGroup(undefined);
    state().actions.setParticipants([me]);
  };
  const selectGroup = () => {
    state().actions.setGroup(trip);
    state().actions.setParticipants([me, friend]);
  };

  void it('uses the group currency and goes back to the user currency without the group', () => {
    start();
    selectGroup();
    assert.equal(state().currency, 'EUR');

    removeGroup();
    assert.equal(state().currency, 'INR');
  });

  void it('keeps a picked currency when the group is removed and selected again', () => {
    start();
    selectGroup();
    state().actions.setAmount(100);
    pickCurrency('GBP');

    removeGroup();
    assert.equal(state().currency, 'GBP');
    selectGroup();
    assert.equal(state().currency, 'GBP');
    assert.equal(state().amount, 100);
  });

  void it('keeps a currency picked before the group', () => {
    start();
    pickCurrency('GBP');
    selectGroup();
    assert.equal(state().currency, 'GBP');
  });

  void it('never applies the group currency to an edit', () => {
    start();
    useAddExpenseStore.setState(
      getEditFormState({
        amount: 1000,
        splitType: SplitType.EQUAL,
        category: 'general',
        currency: 'GBP',
        name: 'Dinner',
        expenseDate: new Date(2026, 8, 30),
        fileKey: null,
        group: trip,
        paidByUser: me,
        expenseParticipants: [
          { amount: 500, user: me },
          { amount: -500, user: friend },
        ],
      }),
    );
    assert.equal(state().currencyTouched, true);

    state().actions.setGroup(trip);
    assert.equal(state().currency, 'GBP');
    state().actions.setGroup(undefined);
    assert.equal(state().currency, 'GBP');
  });

  void it('lets the next form follow the group again after a reset', () => {
    start();
    pickCurrency('GBP');
    state().actions.resetState();
    assert.equal(state().currencyTouched, false);
    assert.equal(state().currency, 'GBP');

    selectGroup();
    assert.equal(state().currency, 'EUR');
  });
});

void describe('settle up payment date', () => {
  const [all] = getSettleUpDestinations({ currency: 'USD', total: 500, nonGroup: 500, groups: [] });

  void it('sends the picked date, and none for today', () => {
    const base = { destination: all!, currency: 'USD', value: 5, currentUserId: 1, friendId: 2 };
    const expenseDate = new Date(2026, 8, 30, 12);

    assert.equal(buildSettleUpPayment({ ...base, expenseDate }).payment.expenseDate, expenseDate);
    assert.equal('expenseDate' in buildSettleUpPayment(base).payment, false);
  });
});

void describe('hasShareWithFriend', () => {
  const ME = 1;
  const FRIEND = 2;
  const expense = (paidBy: number, mine: number | undefined, theirs: number | undefined) => ({
    paidBy,
    expenseParticipants: [
      ...(undefined === mine ? [] : [{ userId: ME, amount: mine }]),
      ...(undefined === theirs ? [] : [{ userId: FRIEND, amount: theirs }]),
    ],
  });

  void it('hides only expenses where the one who did not pay owes nothing', () => {
    const cases: Array<[string, ReturnType<typeof expense>, boolean]> = [
      ['zero, I paid', expense(ME, 0, 0), false],
      ['zero, friend paid', expense(FRIEND, 0, 0), false],
      ['I paid', expense(ME, 50, -50), true],
      ['friend paid', expense(FRIEND, -50, 50), true],
      ['refund I paid', expense(ME, -50, 50), true],
      ['settlement friend paid', expense(FRIEND, -100, 100), true],
      ['old expense without my payer row', expense(ME, undefined, -50), true],
      ['old expense without their payer row', expense(FRIEND, -50, undefined), true],
    ];

    cases.forEach(([name, e, listed]) =>
      assert.equal(hasShareWithFriend(e, ME, FRIEND), listed, name),
    );
  });
});
