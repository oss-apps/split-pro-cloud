import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Group, type User } from '@prisma/client';

import { addRecentCurrency, MAX_RECENT_CURRENCIES } from '~/hooks/useRecentCurrencies';
import { useAddExpenseStore } from '~/store/addStore';
import {
  formatMonthHeader,
  formatShortDate,
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
  const start = () => {
    useAddExpenseStore.setState({ currentUser: me, preferredCurrency: 'INR' });
    useAddExpenseStore.getState().actions.resetState();
  };

  void it('uses the group currency and goes back to the user currency without the group', () => {
    start();
    const { setGroup } = useAddExpenseStore.getState().actions;

    setGroup(group(1, 'EUR'));
    assert.equal(useAddExpenseStore.getState().currency, 'EUR');

    setGroup(undefined);
    assert.equal(useAddExpenseStore.getState().currency, 'INR');
  });

  void it('keeps a currency picked by hand when the group is removed', () => {
    start();
    const { setGroup, setCurrency } = useAddExpenseStore.getState().actions;

    setGroup(group(1, 'EUR'));
    setCurrency('GBP');
    setGroup(undefined);
    assert.equal(useAddExpenseStore.getState().currency, 'GBP');
  });

  void it('starts the next expense from the user currency again', () => {
    start();
    useAddExpenseStore.getState().actions.setGroup(group(1, 'EUR'));
    useAddExpenseStore.getState().actions.resetState();
    assert.equal(useAddExpenseStore.getState().currency, 'INR');
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
