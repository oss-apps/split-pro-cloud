import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType, type User } from '@prisma/client';

import { calculateParticipantSplit, type Participant, useAddExpenseStore } from '~/store/addStore';
import { toInteger } from '~/utils/numbers';
import { toBalancedParticipants } from '~/utils/splits';

const createUser = (id: number): User => ({
  id,
  name: `User ${id}`,
  email: `user-${id}@example.com`,
  emailVerified: null,
  image: null,
  currency: 'USD',
});

void describe('split cent conservation', () => {
  const users = [createUser(1), createUser(2), createUser(3)];
  const cases = [
    { splitType: SplitType.EQUAL, shares: [1, 1, 1] },
    { splitType: SplitType.PERCENTAGE, shares: [33.33, 33.33, 33.34] },
    { splitType: SplitType.SHARE, shares: [1, 1, 1] },
    { splitType: SplitType.EXACT, shares: [3.33, 3.33, 3.34] },
    { splitType: SplitType.ADJUSTMENT, shares: [0, 0, 0] },
  ];

  cases.forEach(({ splitType, shares }) => {
    users.forEach((payer) => {
      void it(`balances ${splitType} cents when user ${payer.id} pays`, () => {
        const participants: Participant[] = users.map((user, index) => ({
          ...user,
          splitShare: shares[index],
        }));
        const result = calculateParticipantSplit(10, participants, splitType, payer);
        const storedAmounts = result.participants.map((participant) =>
          toInteger(participant.amount ?? 0),
        );

        assert.equal(result.canSplitScreenClosed, true);
        assert.equal(
          storedAmounts.reduce((total, participantAmount) => total + participantAmount, 0),
          0,
        );
      });
    });
  });

  void it('rejects zero and non-finite SHARE totals without producing non-finite amounts', () => {
    const invalidShares = [
      [0, 0, 0],
      [1, -1, 0],
      [Number.POSITIVE_INFINITY, 1, 1],
    ];

    invalidShares.forEach((shares) => {
      const participants: Participant[] = users.map((user, index) => ({
        ...user,
        splitShare: shares[index],
      }));
      const result = calculateParticipantSplit(10, participants, SplitType.SHARE, users[0]);

      assert.equal(result.canSplitScreenClosed, false);
      assert.equal(
        result.participants.every((participant) => Number.isFinite(participant.amount)),
        true,
      );
    });
  });

  void it('normalizes bounded rounding drift from old clients', () => {
    assert.deepEqual(
      toBalancedParticipants(
        10,
        1,
        [
          { userId: 1, amount: 6.67 },
          { userId: 2, amount: -3.33 },
          { userId: 3, amount: -3.33 },
        ],
        SplitType.EQUAL,
      ),
      [
        { userId: 1, amount: 6.66 },
        { userId: 2, amount: -3.33 },
        { userId: 3, amount: -3.33 },
      ],
    );
  });

  void it('canonicalizes settlements to the payer receiving the full amount back', () => {
    assert.deepEqual(
      toBalancedParticipants(
        10,
        1,
        [
          { userId: 1, amount: 0 },
          { userId: 2, amount: 10 },
        ],
        SplitType.SETTLEMENT,
      ),
      [
        { userId: 1, amount: 10 },
        { userId: 2, amount: -10 },
      ],
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          10,
          1,
          [
            { userId: 1, amount: 10 },
            { userId: 2, amount: -5 },
            { userId: 3, amount: -5 },
          ],
          SplitType.SETTLEMENT,
        ),
      /between two people/,
    );
  });

  void it('mirrors signs for negative expenses', () => {
    assert.deepEqual(
      toBalancedParticipants(
        -10,
        1,
        [
          { userId: 1, amount: -6.67 },
          { userId: 2, amount: 3.33 },
          { userId: 3, amount: 3.33 },
        ],
        SplitType.EQUAL,
      ),
      [
        { userId: 1, amount: -6.66 },
        { userId: 2, amount: 3.33 },
        { userId: 3, amount: 3.33 },
      ],
    );
    assert.deepEqual(
      toBalancedParticipants(
        -10,
        1,
        [
          { userId: 1, amount: -7 },
          { userId: 2, amount: 7 },
        ],
        SplitType.PERCENTAGE,
      ),
      [
        { userId: 1, amount: -7 },
        { userId: 2, amount: 7 },
      ],
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          -10,
          1,
          [
            { userId: 1, amount: 5 },
            { userId: 2, amount: -5 },
          ],
          SplitType.EQUAL,
        ),
      /do not match the expense amount/,
    );
  });

  void it('adds a missing payer from the other participants', () => {
    assert.deepEqual(
      toBalancedParticipants(
        10,
        1,
        [
          { userId: 2, amount: -5 },
          { userId: 3, amount: -5 },
        ],
        SplitType.EQUAL,
      ),
      [
        { userId: 2, amount: -5 },
        { userId: 3, amount: -5 },
        { userId: 1, amount: 10 },
      ],
    );
  });

  void it('allows negative exact shares as long as the amounts balance', () => {
    assert.deepEqual(
      toBalancedParticipants(
        1,
        1,
        [
          { userId: 1, amount: 0 },
          { userId: 2, amount: -3 },
          { userId: 3, amount: 3 },
        ],
        SplitType.EXACT,
      ),
      [
        { userId: 1, amount: 0 },
        { userId: 2, amount: -3 },
        { userId: 3, amount: 3 },
      ],
    );
  });

  void it('rejects material imbalances and invalid debt directions', () => {
    assert.throws(
      () =>
        toBalancedParticipants(
          10,
          1,
          [
            { userId: 1, amount: 5 },
            { userId: 2, amount: -3 },
          ],
          SplitType.EXACT,
        ),
      /must add up/,
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          10,
          1,
          [
            { userId: 1, amount: 0 },
            { userId: 2, amount: 5 },
            { userId: 3, amount: -5 },
          ],
          SplitType.EQUAL,
        ),
      /do not match the expense amount/,
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          10,
          1,
          [
            { userId: 1, amount: 20 },
            { userId: 2, amount: -20 },
          ],
          SplitType.SHARE,
        ),
      /do not match the expense amount/,
    );
    assert.throws(
      () =>
        toBalancedParticipants(
          10,
          1,
          [
            { userId: 1, amount: 10 },
            { userId: 1, amount: -10 },
          ],
          SplitType.EQUAL,
        ),
      /must be unique/,
    );
    assert.throws(
      () => toBalancedParticipants(Number.NaN, 1, [{ userId: 1, amount: 0 }], SplitType.EQUAL),
      /not valid/,
    );
  });
});

void describe('split type conversion', () => {
  void it('reconstructs percentage shares from the current participant amounts', () => {
    const payer = createUser(1);
    const friend = createUser(2);

    useAddExpenseStore.setState({
      amount: 10,
      paidBy: payer,
      splitType: SplitType.EQUAL,
      participants: [
        { ...payer, amount: 5, splitShare: 1 },
        { ...friend, amount: -5, splitShare: 1 },
      ],
    });

    useAddExpenseStore.getState().actions.setSplitType(SplitType.PERCENTAGE);

    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.splitShare),
      [50, 50],
    );
    assert.equal(useAddExpenseStore.getState().canSplitScreenClosed, true);
  });

  void it('keeps settlement signs when the amount is edited', () => {
    const payer = createUser(1);
    const friend = createUser(2);

    useAddExpenseStore.setState({
      amount: 5,
      paidBy: payer,
      splitType: SplitType.SETTLEMENT,
      participants: [
        { ...payer, amount: 5 },
        { ...friend, amount: -5 },
      ],
    });

    useAddExpenseStore.getState().actions.setAmount(8);

    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.amount),
      [8, -8],
    );
    assert.equal(useAddExpenseStore.getState().canSplitScreenClosed, true);
  });

  void it('reconstructs exact shares of a refund', () => {
    const payer = createUser(1);
    const friend = createUser(2);

    useAddExpenseStore.setState({
      amount: -10,
      paidBy: payer,
      splitType: SplitType.EQUAL,
      participants: [
        { ...payer, amount: -5, splitShare: 1 },
        { ...friend, amount: 5, splitShare: 1 },
      ],
    });

    useAddExpenseStore.getState().actions.setSplitType(SplitType.EXACT);

    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.amount),
      [-5, 5],
    );
    assert.equal(useAddExpenseStore.getState().canSplitScreenClosed, true);
  });
});
