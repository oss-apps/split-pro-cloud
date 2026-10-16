import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType } from '@prisma/client';

import { getCategoryLabel } from '~/lib/categories';
import {
  SETTLEMENTS_FILTER,
  filterExpenses,
  getFilterOptions,
  matchesExpenseQuery,
} from '~/utils/expenseSearch';

const expense = (
  name: string,
  category: string,
  amount: number,
  splitType: SplitType = SplitType.EQUAL,
) => ({ name, category, amount, splitType });

const expenses = [
  expense('Café de Flore', 'diningOut', 4550),
  expense('Weekly groceries', 'groceries', 12000),
  expense('Taxi to airport', 'taxi', 4500),
  expense('Settle up', 'general', 3000, SplitType.SETTLEMENT),
  expense('Supermarket', 'groceries', -800),
];

const names = (list: { name: string }[]) => list.map((e) => e.name);

void describe('expense search', () => {
  void it('matches the name ignoring case and accents', () => {
    assert.ok(matchesExpenseQuery(expenses[0]!, 'cafe'));
    assert.ok(matchesExpenseQuery(expenses[0]!, 'FLORE'));
    assert.ok(!matchesExpenseQuery(expenses[0]!, 'taxi'));
  });

  void it('needs every word, each found in the name, category or other text', () => {
    assert.ok(matchesExpenseQuery(expenses[1]!, 'weekly groceries'));
    assert.ok(matchesExpenseQuery(expenses[0]!, 'dining flore'));
    assert.ok(matchesExpenseQuery(expenses[2]!, 'alice taxi', ['Alice', 'Trip to Rome']));
    assert.ok(matchesExpenseQuery(expenses[2]!, 'rome', ['Alice', 'Trip to Rome']));
    assert.ok(!matchesExpenseQuery(expenses[2]!, 'bob taxi', ['Alice', null, undefined]));
  });

  void it('matches typed amounts against the whole units and the cents typed', () => {
    assert.deepEqual(names(filterExpenses(expenses, { query: '45', category: null })), [
      'Café de Flore',
      'Taxi to airport',
    ]);
    assert.deepEqual(names(filterExpenses(expenses, { query: '45.5', category: null })), [
      'Café de Flore',
    ]);
    assert.deepEqual(names(filterExpenses(expenses, { query: '45,00', category: null })), [
      'Taxi to airport',
    ]);
    assert.deepEqual(names(filterExpenses(expenses, { query: '8', category: null })), [
      'Supermarket',
    ]);
  });

  void it('filters by category, with settlements as their own filter', () => {
    assert.deepEqual(names(filterExpenses(expenses, { query: '', category: 'groceries' })), [
      'Weekly groceries',
      'Supermarket',
    ]);
    assert.deepEqual(names(filterExpenses(expenses, { query: '', category: SETTLEMENTS_FILTER })), [
      'Settle up',
    ]);
    assert.deepEqual(names(filterExpenses(expenses, { query: 'weekly', category: 'groceries' })), [
      'Weekly groceries',
    ]);
    assert.equal(filterExpenses(expenses, { query: '  ', category: null }).length, expenses.length);
  });

  void it('lists the categories found, most used first', () => {
    assert.deepEqual(getFilterOptions(expenses), [
      { key: 'groceries', label: 'Groceries' },
      { key: 'diningOut', label: 'Dining Out' },
      { key: SETTLEMENTS_FILTER, label: 'Settlements' },
      { key: 'taxi', label: 'Taxi' },
    ]);
  });

  void it('labels group categories and unknown keys', () => {
    assert.equal(getCategoryLabel('food'), 'Food & Drinks');
    assert.equal(getCategoryLabel('general'), 'General');
    assert.equal(getCategoryLabel('somethingNew'), 'somethingNew');
  });
});
