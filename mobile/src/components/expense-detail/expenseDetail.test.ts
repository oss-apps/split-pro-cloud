import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType } from '@prisma/client';

import {
  canDeleteExpense,
  canEditExpense,
  getParticipantLines,
  getReceiptUrl,
  getShareTone,
} from './expenseDetail';

const user = (id: number) => ({ id, name: `User ${id}`, email: null, image: null });

const expense = {
  amount: 3000,
  paidBy: 1,
  splitType: SplitType.EQUAL,
  deletedBy: null,
  expenseParticipants: [
    { userId: 1, amount: 2000, user: user(1) },
    { userId: 2, amount: -1000, user: user(2) },
    { userId: 3, amount: -1000, user: user(3) },
  ],
};

describe('getParticipantLines', () => {
  it('should give each person their share, the payer included', () => {
    const lines = getParticipantLines(expense, 2);
    assert.deepEqual(
      lines.map((line) => ('share' === line.kind ? [line.user.id, line.share, line.isYou] : null)),
      [
        [1, 1000, false],
        [2, 1000, true],
        [3, 1000, false],
      ],
    );
  });

  it('should give negative shares for a refund', () => {
    const refund = {
      ...expense,
      amount: -3000,
      expenseParticipants: expense.expenseParticipants.map((participant) => ({
        ...participant,
        amount: -participant.amount,
      })),
    };
    assert.deepEqual(
      getParticipantLines(refund, 1).map((line) => ('share' === line.kind ? line.share : null)),
      [-1000, -1000, -1000],
    );
  });

  it('should list who received a settlement, without the payer', () => {
    const settlement = {
      ...expense,
      splitType: SplitType.SETTLEMENT,
      amount: 500,
      expenseParticipants: [
        { userId: 1, amount: 500, user: user(1) },
        { userId: 2, amount: -500, user: user(2) },
      ],
    };
    assert.deepEqual(getParticipantLines(settlement, 2), [
      { kind: 'received', user: user(2), isYou: true, amount: 500 },
    ]);
  });
});

describe('getShareTone', () => {
  const tones = (paidBy: number, userId: number, source = expense) =>
    getParticipantLines({ ...source, paidBy }, userId).map((line) =>
      getShareTone(line, paidBy, userId),
    );

  it('should show what others owe the payer as lent', () => {
    assert.deepEqual(tones(1, 1), ['none', 'lent', 'lent']);
  });

  it('should show your own share as owed when someone else paid', () => {
    assert.deepEqual(tones(1, 2), ['none', 'owe', 'none']);
  });

  it('should flip for a refund', () => {
    const refund = {
      ...expense,
      amount: -3000,
      expenseParticipants: expense.expenseParticipants.map((participant) => ({
        ...participant,
        amount: -participant.amount,
      })),
    };
    assert.deepEqual(tones(1, 1, refund), ['none', 'owe', 'owe']);
    assert.deepEqual(tones(1, 2, refund), ['none', 'lent', 'none']);
  });
});

describe('canEditExpense', () => {
  it('should not allow changing a deleted expense', () => {
    assert.equal(canEditExpense(expense), true);
    assert.equal(canEditExpense({ deletedBy: 1 }), false);
  });
});

describe('canDeleteExpense', () => {
  it('should only allow people in the expense', () => {
    assert.equal(canDeleteExpense(expense, 3), true);
    assert.equal(canDeleteExpense(expense, 4), false);
    assert.equal(canDeleteExpense({ ...expense, deletedBy: 3 }, 3), false);
  });
});

describe('getReceiptUrl', () => {
  it('should join the public URL and key', () => {
    assert.equal(
      getReceiptUrl('https://cdn.example.com/', '1/a.jpg'),
      'https://cdn.example.com/1/a.jpg',
    );
  });

  it('should be undefined without a public URL or receipt', () => {
    assert.equal(getReceiptUrl(null, '1/a.jpg'), undefined);
    assert.equal(getReceiptUrl('https://cdn.example.com', null), undefined);
  });
});
