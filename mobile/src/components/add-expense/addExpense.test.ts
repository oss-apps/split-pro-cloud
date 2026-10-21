import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType, type User } from '@prisma/client';

import {
  type Participant,
  calculateParticipantSplit,
  useAddExpenseStore,
} from '@/store/addExpenseStore';

import { parseAmountInput, sanitizeAmountInput, toggleAmountSign } from './amountInput';
import { getMonthWeeks, isTodayOrUnset, shiftMonth } from './calendar';
import { getFormSnapshot } from './formChanges';
import {
  getParticipantShare,
  getSplitInputText,
  getSplitStatus,
  isEveryoneIncluded,
  parseSplitValue,
} from './splitStatus';

const createUser = (id: number): User => ({
  id,
  name: `User ${id}`,
  email: `user-${id}@example.com`,
  emailVerified: null,
  image: null,
  currency: 'USD',
  deletedAt: null,
});

const users = [createUser(1), createUser(2), createUser(3)];
const withShares = (shares: number[]): Participant[] =>
  users.map((user, index) => ({ ...user, splitShare: shares[index] }));

describe('sanitizeAmountInput', () => {
  it('should keep digits and one decimal point', () => {
    assert.equal(sanitizeAmountInput('12.50'), '12.50');
    assert.equal(sanitizeAmountInput('1.2.3'), '1.23');
    assert.equal(sanitizeAmountInput('abc12'), '12');
  });

  it('should turn a comma into a decimal point', () => {
    assert.equal(sanitizeAmountInput('12,5'), '12.5');
  });

  it('should keep at most 2 decimals', () => {
    assert.equal(sanitizeAmountInput('9.999'), '9.99');
  });

  it('should keep a leading minus for a refund', () => {
    assert.equal(sanitizeAmountInput('-12'), '-12');
    assert.equal(sanitizeAmountInput('-'), '-');
    assert.equal(sanitizeAmountInput('1-2'), '12');
  });
});

describe('parseAmountInput', () => {
  it('should parse amounts and refunds', () => {
    assert.equal(parseAmountInput('12.5'), 12.5);
    assert.equal(parseAmountInput('-3'), -3);
  });

  it('should be 0 while the text is not a number yet', () => {
    assert.equal(parseAmountInput(''), 0);
    assert.equal(parseAmountInput('-'), 0);
    assert.equal(parseAmountInput('.'), 0);
  });
});

describe('toggleAmountSign', () => {
  it('should flip the sign both ways', () => {
    assert.equal(toggleAmountSign('12'), '-12');
    assert.equal(toggleAmountSign('-12'), '12');
    assert.equal(toggleAmountSign(''), '-');
  });
});

describe('getSplitStatus', () => {
  describe('EQUAL', () => {
    it('should divide the amount among included people', () => {
      assert.deepEqual(getSplitStatus(SplitType.EQUAL, withShares([1, 1, 0]), 30), {
        kind: 'perPerson',
        amount: 15,
      });
    });

    it('should be 0 rather than infinite when nobody is included', () => {
      assert.deepEqual(getSplitStatus(SplitType.EQUAL, withShares([0, 0, 0]), 30), {
        kind: 'perPerson',
        amount: 0,
      });
    });
  });

  describe('PERCENTAGE', () => {
    it('should show the percentage left to assign', () => {
      assert.deepEqual(getSplitStatus(SplitType.PERCENTAGE, withShares([33.33, 33.33, 0]), 10), {
        kind: 'remainingPercentage',
        percentage: 33.34,
      });
    });
  });

  describe('EXACT', () => {
    it('should show the amount left on the absolute amount, also for a refund', () => {
      assert.deepEqual(getSplitStatus(SplitType.EXACT, withShares([10, 5.5, 0]), -20), {
        kind: 'remainingAmount',
        amount: 4.5,
      });
    });

    it('should go negative when too much is assigned', () => {
      assert.deepEqual(getSplitStatus(SplitType.EXACT, withShares([10, 15, 0]), 20), {
        kind: 'remainingAmount',
        amount: -5,
      });
    });
  });

  describe('SHARE', () => {
    it('should total the shares', () => {
      assert.deepEqual(getSplitStatus(SplitType.SHARE, withShares([1, 2, 1.5]), 20), {
        kind: 'totalShares',
        shares: '4.5',
      });
    });
  });

  describe('ADJUSTMENT', () => {
    it('should show what is left to split equally', () => {
      assert.deepEqual(getSplitStatus(SplitType.ADJUSTMENT, withShares([5, 0, 0]), 20), {
        kind: 'remainingToSplit',
        amount: 15,
      });
    });
  });
});

describe('parseSplitValue', () => {
  it('should count empty or invalid text as 0', () => {
    assert.equal(parseSplitValue('', SplitType.PERCENTAGE), 0);
    assert.equal(parseSplitValue('abc', SplitType.SHARE), 0);
  });

  it('should round exact amounts to cents only', () => {
    assert.equal(parseSplitValue('3.456', SplitType.EXACT), 3.46);
    assert.equal(parseSplitValue('33.333', SplitType.PERCENTAGE), 33.333);
  });

  it('should accept a decimal comma', () => {
    assert.equal(parseSplitValue('2,5', SplitType.SHARE), 2.5);
  });
});

describe('getSplitInputText', () => {
  it('should round shares and percentages for display but keep exact amounts', () => {
    const [participant] = withShares([33.333333]);
    assert.ok(participant);
    assert.equal(getSplitInputText(participant, SplitType.PERCENTAGE), '33.33');
    assert.equal(getSplitInputText({ ...participant, splitShare: 1.5 }, SplitType.EXACT), '1.5');
    assert.equal(getSplitInputText({ ...participant, splitShare: undefined }, SplitType.SHARE), '');
  });
});

describe('getParticipantShare', () => {
  it('should be what each person owes, for the payer too', () => {
    const payer = users[0];
    const { participants } = calculateParticipantSplit(
      30,
      withShares([1, 1, 1]),
      SplitType.EQUAL,
      payer,
    );
    assert.deepEqual(
      participants.map((participant) => getParticipantShare(participant, payer, 30)),
      [10, 10, 10],
    );
  });

  it('should be negative for a refund', () => {
    const payer = users[0];
    const { participants } = calculateParticipantSplit(
      -30,
      withShares([1, 1, 1]),
      SplitType.EQUAL,
      payer,
    );
    assert.deepEqual(
      participants.map((participant) => getParticipantShare(participant, payer, -30)),
      [-10, -10, -10],
    );
  });
});

describe('isEveryoneIncluded', () => {
  it('should be false when someone is left out', () => {
    assert.equal(isEveryoneIncluded(withShares([1, 1, 1])), true);
    assert.equal(isEveryoneIncluded(withShares([1, 0, 1])), false);
  });
});

describe('getMonthWeeks', () => {
  it('should lay out a month from Sunday with blanks outside it', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = getMonthWeeks(2026, 9);
    assert.equal(weeks.length, 5);
    assert.deepEqual(
      weeks[0]?.map((day) => day?.getDate() ?? null),
      [null, null, null, null, 1, 2, 3],
    );
    assert.deepEqual(
      weeks[4]?.map((day) => day?.getDate() ?? null),
      [25, 26, 27, 28, 29, 30, 31],
    );
  });

  it('should use six rows when the month needs them', () => {
    // August 2026 starts on a Saturday.
    const weeks = getMonthWeeks(2026, 7);
    assert.equal(weeks.length, 6);
    assert.equal(weeks[5]?.[1]?.getDate(), 31);
  });
});

describe('shiftMonth', () => {
  it('should cross year boundaries', () => {
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
    assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth(2026, 5, 2), { year: 2026, month: 7 });
  });
});

describe('isTodayOrUnset', () => {
  it('should treat no date as today', () => {
    const today = new Date(2026, 9, 21, 15);
    assert.equal(isTodayOrUnset(undefined, today), true);
    assert.equal(isTodayOrUnset(new Date(2026, 9, 21), today), true);
    assert.equal(isTodayOrUnset(new Date(2026, 9, 20), today), false);
  });
});

describe('getFormSnapshot', () => {
  it('should change with what the user entered, not with what is on screen', () => {
    const state = { ...useAddExpenseStore.getState(), participants: withShares([1, 1, 1]) };
    const snapshot = getFormSnapshot(state);

    assert.equal(
      getFormSnapshot({ ...state, splitScreenOpen: true, showFriends: false }),
      snapshot,
    );
    assert.notEqual(getFormSnapshot({ ...state, description: 'Lunch' }), snapshot);
    assert.notEqual(getFormSnapshot({ ...state, participants: withShares([2, 1, 1]) }), snapshot);
    assert.notEqual(getFormSnapshot({ ...state, expenseDate: new Date(0) }), snapshot);
  });
});
