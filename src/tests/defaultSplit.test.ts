import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Group, SplitType, type User } from '@prisma/client';

import { getEditFormState, getParticipantsToSave, useAddExpenseStore } from '~/store/addStore';
import {
  MEMBERS_CHANGED_MESSAGE,
  getDefaultSplitError,
  getDefaultSplitNote,
  resolveDefaultSplit,
} from '~/utils/defaultSplit';

const user = (id: number, name: string): User => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  emailVerified: null,
  image: null,
  currency: 'INR',
});

const me = user(1, 'Me');
const alex = user(2, 'Alex');
const sam = user(3, 'Sam');

const group = (defaultSplit?: { splitType: SplitType; shares: Record<number, number> }) =>
  ({
    id: 1,
    name: 'Trip',
    defaultCurrency: 'EUR',
    defaultSplitType: defaultSplit?.splitType ?? null,
    defaultSplitShares: defaultSplit?.shares ?? null,
  }) as Group;

const state = () => useAddExpenseStore.getState();
const start = () => {
  useAddExpenseStore.setState({ currentUser: me, preferredCurrency: 'INR' });
  state().actions.resetState();
};
// As UserInput does on Backspace.
const removeGroup = () => {
  state().actions.setGroup(undefined);
  state().actions.setParticipants([me]);
};
const amounts = () => state().participants.map((p) => [p.id, p.amount]);

void describe('resolveDefaultSplit', () => {
  void it('applies percentages that add up to 100% among the participants', () => {
    assert.deepEqual(
      resolveDefaultSplit({ splitType: 'PERCENTAGE', shares: { 1: 60, 2: 40 } }, [2, 1]),
      {
        splitType: 'PERCENTAGE',
        shares: [40, 60],
        addedIds: [],
        outdated: false,
      },
    );
  });

  void it('splits equally once percentages no longer fit the members', () => {
    const split = { splitType: 'PERCENTAGE', shares: { 1: 60, 2: 40 } } as const;
    for (const ids of [[1, 2, 3], [1]]) {
      const resolved = resolveDefaultSplit(split, ids);
      assert.equal(resolved.splitType, SplitType.EQUAL);
      assert.equal(resolved.outdated, true);
      assert.deepEqual(
        resolved.shares,
        ids.map(() => 1),
      );
    }
  });

  void it('keeps percentages when only someone with 0% left', () => {
    const split = { splitType: 'PERCENTAGE', shares: { 1: 100, 2: 0 } } as const;
    assert.equal(resolveDefaultSplit(split, [1]).outdated, false);
  });

  void it('gives someone new 1 share or an equal share', () => {
    assert.deepEqual(
      resolveDefaultSplit({ splitType: 'SHARE', shares: { 1: 2, 2: 1 } }, [1, 2, 3]),
      {
        splitType: 'SHARE',
        shares: [2, 1, 1],
        addedIds: [3],
        outdated: false,
      },
    );
    assert.deepEqual(
      resolveDefaultSplit({ splitType: 'EQUAL', shares: { 1: 1, 2: 0 } }, [1, 2, 3]).shares,
      [1, 0, 1],
    );
  });

  void it('splits equally when no one left in the split has a share', () => {
    const resolved = resolveDefaultSplit({ splitType: 'SHARE', shares: { 1: 0, 2: 3 } }, [1]);
    assert.equal(resolved.splitType, SplitType.EQUAL);
    assert.equal(resolved.outdated, true);
  });
});

void describe('getDefaultSplitError', () => {
  void it('accepts percentages that add up to 100 despite float noise', () => {
    assert.equal(
      getDefaultSplitError(
        { splitType: 'PERCENTAGE', shares: { 1: 33.33, 2: 33.33, 3: 33.34 } },
        [1, 2, 3],
      ),
      undefined,
    );
    assert.equal(
      getDefaultSplitError({ splitType: 'PERCENTAGE', shares: { 1: 60, 2: 30 } }, [1, 2]),
      'Percentages must add up to 100%.',
    );
  });

  void it('needs exactly the current members', () => {
    const shares = { 1: 1, 2: 1 };
    assert.equal(
      getDefaultSplitError({ splitType: 'SHARE', shares }, [1, 2, 3]),
      MEMBERS_CHANGED_MESSAGE,
    );
    assert.equal(
      getDefaultSplitError({ splitType: 'SHARE', shares }, [1]),
      MEMBERS_CHANGED_MESSAGE,
    );
  });

  void it('needs someone to pay a part', () => {
    assert.ok(getDefaultSplitError({ splitType: 'SHARE', shares: { 1: 0, 2: 0 } }, [1, 2]));
    assert.ok(getDefaultSplitError({ splitType: 'EQUAL', shares: { 1: 0, 2: 0 } }, [1, 2]));
    assert.ok(getDefaultSplitError({ splitType: 'EQUAL', shares: { 1: 2, 2: 1 } }, [1, 2]));
  });
});

void describe('getDefaultSplitNote', () => {
  void it('says what someone new gets, or that the default needs updating', () => {
    assert.equal(
      getDefaultSplitNote({ splitType: 'SHARE' }, ['Sam'], false),
      "Sam isn't in the default split yet and gets 1 share.",
    );
    assert.equal(
      getDefaultSplitNote({ splitType: 'EQUAL' }, ['Sam', 'Lee'], false),
      "Sam and Lee aren't in the default split yet and are included equally.",
    );
    assert.match(
      getDefaultSplitNote({ splitType: 'PERCENTAGE' }, [], true) ?? '',
      /needs updating/,
    );
    assert.equal(getDefaultSplitNote({ splitType: 'PERCENTAGE' }, [], false), undefined);
  });
});

void describe('group default split in the add flow', () => {
  const sixtyForty = group({ splitType: SplitType.PERCENTAGE, shares: { 1: 60, 2: 40 } });

  void it('splits equally without a default', () => {
    start();
    state().actions.selectGroup(group(), [me, alex]);
    state().actions.setAmount(100);

    assert.equal(state().splitType, SplitType.EQUAL);
    assert.deepEqual(amounts(), [
      [1, 50],
      [2, -50],
    ]);
    assert.equal(state().defaultSplitHint, undefined);
  });

  void it('applies the default whether the amount is entered before or after', () => {
    start();
    state().actions.selectGroup(sixtyForty, [alex, me]);
    state().actions.setAmount(100);
    assert.equal(state().splitType, SplitType.PERCENTAGE);
    assert.deepEqual(amounts(), [
      [1, 40],
      [2, -40],
    ]);
    assert.equal(state().currency, 'EUR');
    assert.deepEqual(state().defaultSplitHint, {
      splitType: SplitType.PERCENTAGE,
      addedIds: [],
      outdated: false,
    });

    start();
    state().actions.setAmount(100);
    state().actions.selectGroup(sixtyForty, [me, alex]);
    assert.deepEqual(amounts(), [
      [1, 40],
      [2, -40],
    ]);
    assert.equal(state().canSplitScreenClosed, true);
  });

  void it('gives a new member 1 share of a share default, with a hint', () => {
    start();
    state().actions.selectGroup(group({ splitType: SplitType.SHARE, shares: { 1: 2, 2: 1 } }), [
      me,
      alex,
      sam,
    ]);
    state().actions.setAmount(100);

    assert.equal(state().splitType, SplitType.SHARE);
    assert.deepEqual(amounts(), [
      [1, 50],
      [2, -25],
      [3, -25],
    ]);
    assert.deepEqual(state().defaultSplitHint?.addedIds, [3]);
  });

  void it('splits equally with a hint when percentages no longer fit the members', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex, sam]);
    state().actions.setAmount(30);

    assert.equal(state().splitType, SplitType.EQUAL);
    assert.deepEqual(amounts(), [
      [1, 20],
      [2, -10],
      [3, -10],
    ]);
    assert.equal(state().defaultSplitHint?.outdated, true);
  });

  void it('keeps a split changed by hand when the group is removed and selected again', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    state().actions.setAmount(100);
    state().actions.setSplitType(SplitType.SHARE);
    const [mine, theirs] = state().participants;
    state().actions.addOrUpdateParticipant({ ...mine!, splitShare: 1 });
    state().actions.addOrUpdateParticipant({ ...theirs!, splitShare: 3 });
    assert.equal(state().splitTouched, true);
    assert.equal(state().defaultSplitHint, undefined);

    removeGroup();
    assert.equal(state().splitType, SplitType.EQUAL);
    state().actions.selectGroup(sixtyForty, [me, alex]);

    assert.equal(state().splitType, SplitType.SHARE);
    assert.deepEqual(amounts(), [
      [1, 75],
      [2, -75],
    ]);
    assert.equal(state().defaultSplitHint, undefined);
  });

  void it('keeps an equal split picked by hand over the default', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    state().actions.setAmount(100);
    state().actions.setSplitType(SplitType.EQUAL);

    removeGroup();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    assert.equal(state().splitType, SplitType.EQUAL);
    assert.deepEqual(amounts(), [
      [1, 50],
      [2, -50],
    ]);
  });

  void it('opening the split without changing it keeps following the default', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    state().actions.setSplitScreenOpen(true);
    state().actions.setSplitScreenOpen(false);
    assert.equal(state().splitTouched, false);
  });

  void it('never applies the default to an edit', () => {
    start();
    useAddExpenseStore.setState(
      getEditFormState({
        amount: 1000,
        splitType: SplitType.EQUAL,
        category: 'general',
        currency: 'EUR',
        name: 'Dinner',
        expenseDate: new Date(2026, 8, 30),
        fileKey: null,
        group: sixtyForty,
        paidByUser: me,
        expenseParticipants: [
          { amount: 667, user: me },
          { amount: -667, user: alex },
        ],
      }),
    );
    assert.equal(state().splitTouched, true);
    assert.deepEqual(
      getParticipantsToSave(state()).map((p) => p.amount),
      [6.67, -6.67],
    );

    removeGroup();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    assert.equal(state().splitType, SplitType.EQUAL);
    assert.equal(state().defaultSplitHint, undefined);
  });

  void it('lets the next form take the default again after a reset', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex]);
    state().actions.setSplitType(SplitType.EQUAL);
    state().actions.resetState();
    assert.equal(state().splitTouched, false);
    assert.equal(state().manualSplit, undefined);

    state().actions.selectGroup(sixtyForty, [me, alex]);
    assert.equal(state().splitType, SplitType.PERCENTAGE);
  });

  void it('drops the hint once the group is removed', () => {
    start();
    state().actions.selectGroup(sixtyForty, [me, alex, sam]);
    removeGroup();
    assert.equal(state().defaultSplitHint, undefined);
  });
});
