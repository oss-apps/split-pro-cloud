import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType, type User } from '@prisma/client';

import {
  type Participant,
  calculateParticipantSplit,
  calculateSplitShareBasedOnAmount,
  getRemainingPercentage,
  useAddExpenseStore,
} from '~/store/addStore';
import {
  getNetForUser,
  getNetShareLabel,
  getNetWithFriend,
  getParticipantShareLabel,
} from '~/utils/expenseLabels';
import {
  AMOUNT_TOO_LARGE_MESSAGE,
  isAmountWithinLimit,
  toInteger,
  toSignedUIString,
} from '~/utils/numbers';
import { toBalancedParticipants } from '~/utils/splits';

const createUser = (id: number): User => ({
  id,
  name: `User ${id}`,
  email: `user-${id}@example.com`,
  emailVerified: null,
  image: null,
  currency: 'USD',
});

const users = [createUser(1), createUser(2), createUser(3)];
const withShares = (shares: number[]): Participant[] =>
  users.map((user, index) => ({ ...user, splitShare: shares[index] }));
const toCents = (participants: Participant[]) =>
  participants.map((participant) => toInteger(participant.amount ?? 0));

void describe('expense labels', () => {
  void it('labels the net amount by its sign, not by who paid', () => {
    assert.deepEqual(getNetShareLabel(2000), { label: 'You lent', tone: 'lent', amount: 2000 });
    assert.deepEqual(getNetShareLabel(-1000), { label: 'You owe', tone: 'owe', amount: 1000 });
    assert.deepEqual(getNetShareLabel(0), { label: 'No balance', tone: 'none', amount: 0 });
  });

  void it('labels expenses the user is not part of as not involved', () => {
    const expense = { paidBy: 2, expenseParticipants: [{ userId: 2, amount: 0 }] };

    assert.equal(getNetForUser(expense, 1), undefined);
    assert.equal(getNetShareLabel(getNetForUser(expense, 1)).label, 'Not involved');
    assert.equal(getNetShareLabel(getNetForUser(expense, 2)).label, 'No balance');
  });

  void it('labels a refund payer as owing and the others as lent', () => {
    // A -30.00 refund paid by user 1, split equally between three people.
    const refund = {
      paidBy: 1,
      expenseParticipants: [
        { userId: 1, amount: -2000 },
        { userId: 2, amount: 1000 },
        { userId: 3, amount: 1000 },
      ],
    };

    assert.equal(getNetShareLabel(getNetWithFriend(refund, 1, 2)).label, 'You owe');
    assert.equal(getNetShareLabel(getNetWithFriend(refund, 1, 2)).amount, 1000);
    assert.equal(getNetShareLabel(getNetWithFriend(refund, 2, 1)).label, 'You lent');
  });

  void it('labels a normal expense from both sides of a friendship', () => {
    const expense = {
      paidBy: 1,
      expenseParticipants: [
        { userId: 1, amount: 1000 },
        { userId: 2, amount: -1000 },
      ],
    };

    assert.equal(getNetShareLabel(getNetWithFriend(expense, 1, 2)).label, 'You lent');
    assert.equal(getNetShareLabel(getNetWithFriend(expense, 2, 1)).label, 'You owe');
  });

  void it('says who gets money back from a refund', () => {
    assert.deepEqual(getParticipantShareLabel(1000, true, 'Alice'), {
      label: 'You owe',
      amount: 1000,
    });
    assert.deepEqual(getParticipantShareLabel(-1000, false, 'Alice'), {
      label: 'Alice gets back',
      amount: 1000,
    });
  });

  void it('keeps the minus sign on negative amounts', () => {
    assert.equal(
      toSignedUIString(-3000),
      `-${(30).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    );
    assert.equal(toSignedUIString(3000).startsWith('-'), false);
    assert.equal(toSignedUIString(0).startsWith('-'), false);
  });
});

void describe('amount limit', () => {
  void it('accepts amounts up to the largest storable cents value', () => {
    assert.equal(isAmountWithinLimit(21_474_836.47), true);
    assert.equal(isAmountWithinLimit(-21_474_836.47), true);
    assert.equal(isAmountWithinLimit(21_474_836.48), false);
    assert.equal(isAmountWithinLimit(Number.POSITIVE_INFINITY), false);
  });

  void it('rejects an expense or participant amount that does not fit with a clear message', () => {
    assert.throws(
      () =>
        toBalancedParticipants(
          30_000_000,
          1,
          [
            { userId: 1, amount: 15_000_000 },
            { userId: 2, amount: -15_000_000 },
          ],
          SplitType.EQUAL,
        ),
      { message: AMOUNT_TOO_LARGE_MESSAGE },
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          1,
          1,
          [
            { userId: 1, amount: 30_000_000 },
            { userId: 2, amount: -29_999_999 },
          ],
          SplitType.EXACT,
        ),
      { message: AMOUNT_TOO_LARGE_MESSAGE },
    );
    assert.doesNotThrow(() =>
      toBalancedParticipants(
        21_474_836.46,
        1,
        [
          { userId: 1, amount: 10_737_418.23 },
          { userId: 2, amount: -10_737_418.23 },
        ],
        SplitType.EQUAL,
      ),
    );
  });
});

void describe('percentage splits', () => {
  void it('accepts percentages that add up to 100 despite float noise', () => {
    const shares = [0.01, 65.4, 34.59];
    assert.notEqual(
      100 - shares.reduce((total, share) => total + share, 0),
      0,
      'the old exact float check would reject these',
    );

    assert.equal(getRemainingPercentage(withShares(shares)), 0);
    assert.equal(
      calculateParticipantSplit(10, withShares(shares), SplitType.PERCENTAGE, users[0])
        .canSplitScreenClosed,
      true,
    );
  });

  void it('still rejects percentages that do not add up to 100', () => {
    assert.equal(getRemainingPercentage(withShares([33.33, 33.33, 33.33])), 0.01);
    assert.equal(
      calculateParticipantSplit(10, withShares([33.33, 33.33, 33.33]), SplitType.PERCENTAGE)
        .canSplitScreenClosed,
      false,
    );
  });

  void it('rebuilds percentages that add up to exactly 100 from penny amounts', () => {
    const equal = calculateParticipantSplit(7, withShares([1, 1, 1]), SplitType.EQUAL, users[0]);
    const rebuilt = calculateSplitShareBasedOnAmount(
      7,
      equal.participants,
      SplitType.PERCENTAGE,
      users[0],
    );

    assert.equal(getRemainingPercentage(rebuilt), 0);
  });

  void it('compares exact splits to the cent', () => {
    assert.equal(
      calculateParticipantSplit(10, withShares([3.33, 3.33, 3.33]), SplitType.EXACT, users[0])
        .canSplitScreenClosed,
      false,
    );
    assert.equal(
      calculateParticipantSplit(10, withShares([3.33, 3.33, 3.34]), SplitType.EXACT, users[0])
        .canSplitScreenClosed,
      true,
    );
  });
});

void describe('negative expenses', () => {
  const cases = [
    { splitType: SplitType.EQUAL, shares: [1, 1, 1] },
    { splitType: SplitType.EQUAL, shares: [1, 0, 1] },
    { splitType: SplitType.PERCENTAGE, shares: [20, 30, 50] },
    { splitType: SplitType.EXACT, shares: [5, 10, 15] },
    { splitType: SplitType.SHARE, shares: [1, 2, 3] },
    { splitType: SplitType.ADJUSTMENT, shares: [0, 5, 1] },
  ];

  cases.forEach(({ splitType, shares }) => {
    void it(`mirrors a ${splitType} refund and survives the edit round trip`, () => {
      const payer = users[0];
      const expense = calculateParticipantSplit(30, withShares(shares), splitType, payer);
      const refund = calculateParticipantSplit(-30, withShares(shares), splitType, payer);

      assert.equal(refund.canSplitScreenClosed, true);
      assert.deepEqual(
        toCents(refund.participants),
        toCents(expense.participants).map((cents) => 0 - cents),
      );

      // Editing: rebuild the inputs from the stored amounts, then recalculate.
      const rebuilt = calculateSplitShareBasedOnAmount(-30, refund.participants, splitType, payer);
      assert.equal(
        rebuilt.every((participant) => 0 <= (participant.splitShare ?? 0)),
        true,
        'refund inputs are rebuilt as positive values',
      );
      const recalculated = calculateParticipantSplit(-30, rebuilt, splitType, payer);

      assert.equal(recalculated.canSplitScreenClosed, true);
      assert.deepEqual(toCents(recalculated.participants), toCents(refund.participants));
      assert.doesNotThrow(() =>
        toBalancedParticipants(
          -30,
          payer!.id,
          recalculated.participants.map((participant) => ({
            userId: participant.id,
            amount: participant.amount ?? 0,
          })),
          splitType,
        ),
      );
    });
  });

  [10, -10].forEach((amount) => {
    void it(`keeps penny splits of ${amount} when switching split type`, () => {
      const payer = users[0];
      const equal = calculateParticipantSplit(
        amount,
        withShares([1, 1, 1]),
        SplitType.EQUAL,
        payer,
      );

      [SplitType.PERCENTAGE, SplitType.EXACT, SplitType.SHARE, SplitType.ADJUSTMENT].forEach(
        (splitType) => {
          const rebuilt = calculateSplitShareBasedOnAmount(
            amount,
            equal.participants,
            splitType,
            payer,
          );
          const result = calculateParticipantSplit(amount, rebuilt, splitType, payer);

          assert.equal(result.canSplitScreenClosed, true, splitType);
          assert.deepEqual(toCents(result.participants), toCents(equal.participants), splitType);
        },
      );
    });
  });

  void it('rebuilds adjustments as differences from the smallest share', () => {
    const payer = users[0];
    const refund = calculateParticipantSplit(
      -30,
      withShares([0, 6, 3]),
      SplitType.ADJUSTMENT,
      payer,
    );

    assert.deepEqual(
      calculateSplitShareBasedOnAmount(-30, refund.participants, SplitType.ADJUSTMENT, payer).map(
        (participant) => participant.splitShare,
      ),
      [0, 6, 3],
    );
  });
});

void describe('add expense store reset', () => {
  void it('clears everything from the previous expense, including the date', () => {
    const me = createUser(1);
    const friend = createUser(2);

    useAddExpenseStore.setState({
      currentUser: me,
      preferredCurrency: 'USD',
      amount: 12,
      amountStr: '12',
      currency: 'EUR',
      category: 'food',
      description: 'Old dinner',
      expenseDate: new Date('2024-01-02'),
      fileKey: '1/receipt.png',
      group: { id: 5 } as never,
      paidBy: friend,
      participants: [
        { ...me, amount: -6, splitShare: 50 },
        { ...friend, amount: 6, splitShare: 50 },
      ],
      splitType: SplitType.PERCENTAGE,
      showFriends: false,
      splitScreenOpen: true,
      canSplitScreenClosed: false,
      nameOrEmail: 'bob',
    });

    useAddExpenseStore.getState().actions.resetState();
    const state = useAddExpenseStore.getState();

    assert.equal(state.amount, 0);
    assert.equal(state.amountStr, '');
    assert.equal(state.currency, 'USD');
    assert.equal(state.category, 'general');
    assert.equal(state.description, '');
    assert.equal(state.expenseDate, undefined);
    assert.equal(state.fileKey, undefined);
    assert.equal(state.group, undefined);
    assert.equal(state.paidBy, me);
    assert.deepEqual(state.participants, [me]);
    assert.equal(state.splitType, SplitType.EQUAL);
    assert.equal(state.showFriends, true);
    assert.equal(state.splitScreenOpen, false);
    assert.equal(state.canSplitScreenClosed, true);
    assert.equal(state.nameOrEmail, '');
  });

  void it('keeps the currency of the expense being edited when the session refreshes', () => {
    useAddExpenseStore.setState({ currency: 'EUR', preferredCurrency: 'USD' });

    useAddExpenseStore.getState().actions.setPreferredCurrency('INR');

    assert.equal(useAddExpenseStore.getState().currency, 'EUR');
    useAddExpenseStore.getState().actions.resetState();
    assert.equal(useAddExpenseStore.getState().currency, 'INR');
  });
});
