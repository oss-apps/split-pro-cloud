import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Group, SplitType, type User } from '@prisma/client';

import {
  getEditFormState,
  getParticipantsToSave,
  inviteParticipant,
  useAddExpenseStore,
} from '~/store/addStore';
import {
  DECIMALS_MESSAGE,
  type DefaultSplit,
  MEMBERS_CHANGED_MESSAGE,
  PERCENTAGE_SUM_MESSAGE,
  defaultSplitSchema,
  getDefaultSplitError,
  getDefaultSplitNote,
  getEditorSplit,
  getEditorValues,
  getGroupDefaultSplit,
  isSameDefaultSplit,
  parseMemberId,
  resolveDefaultSplit,
} from '~/utils/defaultSplit';
import { toBalancedParticipants } from '~/utils/splits';

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

/** A small seeded generator, so the property tests are random but repeatable. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

/** Percentages for `count` members in whole hundredths adding up to 100%, some of them 0. */
const randomPercentages = (next: () => number, count: number) => {
  const cuts = Array.from({ length: count - 1 }, () => Math.floor(next() * 10_001)).sort(
    (a, b) => a - b,
  );
  return [...cuts, 10_000].map((cut, index) => (cut - (cuts[index - 1] ?? 0)) / 100);
};

const AMOUNTS = [
  0.01, 0.02, 0.03, 0.07, 1, 1.01, 9.99, 33.33, 100, 1234.56, 21_474_836.47, -0.01, -100,
];

void describe('default split values', () => {
  const isValid = (shares: Record<string, number>, splitType: SplitType = 'SHARE') =>
    defaultSplitSchema.safeParse({ splitType, shares }).success;

  void it('takes at most 2 decimals, so the editor shows and saves them exactly', () => {
    [0.006, 0.004, 49.996, 33.333, 1.000000001, 0.001, -1, 1_000_001, Infinity, NaN].forEach(
      (value) => assert.equal(isValid({ 1: value, 2: 1 }), false, String(value)),
    );
    [0, 0.01, 0.29, 2.5, 33.33, 1_000_000].forEach((value) =>
      assert.equal(isValid({ 1: value, 2: 1 }), true, String(value)),
    );
    assert.equal(
      getDefaultSplitError({ splitType: 'SHARE', shares: { 1: 0.006, 2: 0.004 } }, [1, 2]),
      DECIMALS_MESSAGE,
    );
  });

  void it('rejects percentages that only add up to 100% once each is rounded', () => {
    [49.996, 50.004].forEach((value) => {
      const split = { splitType: 'PERCENTAGE', shares: { 1: value, 2: value } } as const;
      assert.equal(defaultSplitSchema.safeParse(split).success, false);
      assert.equal(getDefaultSplitError(split, [1, 2]), DECIMALS_MESSAGE);
    });
    assert.equal(
      getDefaultSplitError({ splitType: 'PERCENTAGE', shares: { 1: 50.01, 2: 50 } }, [1, 2]),
      PERCENTAGE_SUM_MESSAGE,
    );
  });

  void it('takes member ids only as String(id) writes them', () => {
    ['077', '+77', '77.0', ' 77', '77 ', '0x4d', '7e1', '0', '-1', '2147483648', ''].forEach(
      (key) => {
        assert.equal(parseMemberId(key), undefined, key);
        assert.equal(isValid({ [key]: 1, 2: 1 }), false, key);
      },
    );
    [1, 77, 2_147_483_647].forEach((id) => assert.equal(parseMemberId(String(id)), id));
    // The same member twice under another spelling is rejected, not merged.
    assert.equal(isValid({ 77: 50, '077': 50 }, 'PERCENTAGE'), false);
    assert.equal(
      getDefaultSplitError(
        { splitType: 'EQUAL', shares: { '077': 0, 2: 1 } as Record<string, number> },
        [77, 2],
      ),
      MEMBERS_CHANGED_MESSAGE,
    );
    // A stored split with such a key is no default at all, rather than one that misses someone.
    assert.equal(
      getGroupDefaultSplit({ defaultSplitType: 'EQUAL', defaultSplitShares: { '077': 0, 2: 1 } }),
      undefined,
    );
  });

  void it('opens in the editor and saves unchanged as the same split', () => {
    const next = random(7);
    const splits: DefaultSplit[] = [
      { splitType: 'SHARE', shares: { 1: 0.01, 2: 2.5, 3: 0 } },
      { splitType: 'EQUAL', shares: { 1: 1, 2: 0, 3: 1 } },
      ...Array.from({ length: 200 }, (_, index): DefaultSplit => {
        const ids = Array.from({ length: 1 + (index % 6) }, (__, i) => 10 + i * 7);
        const values =
          0 === index % 2
            ? randomPercentages(next, ids.length)
            : ids.map(() => Math.round(next() * 100_000) / 100 || 1);
        return {
          splitType: 0 === index % 2 ? 'PERCENTAGE' : 'SHARE',
          shares: Object.fromEntries(ids.map((id, i) => [id, values[i] ?? 0])),
        };
      }),
    ];

    splits.forEach((split) => {
      const ids = Object.keys(split.shares).map(Number);
      assert.equal(getDefaultSplitError(split, ids), undefined, JSON.stringify(split));
      const stored = JSON.parse(JSON.stringify(split.shares)) as unknown;
      const read = getGroupDefaultSplit({
        defaultSplitType: split.splitType,
        defaultSplitShares: stored as Record<string, number>,
      });
      assert.ok(read);
      const saved = getEditorSplit(
        split.splitType,
        getEditorValues(read, ids)[split.splitType],
        ids,
      );
      assert.equal(JSON.stringify(saved.shares), JSON.stringify(stored));
      assert.equal(isSameDefaultSplit(read, saved), true);
    });
  });

  void it('tells a save that changes nothing from one that does', () => {
    const split: DefaultSplit = { splitType: 'SHARE', shares: { 1: 2, 2: 1 } };
    assert.equal(isSameDefaultSplit(split, { splitType: 'SHARE', shares: { 2: 1, 1: 2 } }), true);
    assert.equal(
      isSameDefaultSplit(split, { splitType: 'SHARE', shares: { 1: 2, 2: 1.5 } }),
      false,
    );
    assert.equal(
      isSameDefaultSplit(split, { splitType: 'PERCENTAGE', shares: { 1: 2, 2: 1 } }),
      false,
    );
    assert.equal(isSameDefaultSplit(split, { splitType: 'SHARE', shares: { 1: 2 } }), false);
    assert.equal(isSameDefaultSplit(undefined, split), false);
  });
});

void describe('every accepted percentage default can be saved', () => {
  void it('closes the split screen and balances for any amount', () => {
    const next = random(42);
    const members = Array.from({ length: 6 }, (_, index) => user(index + 1, `M${index + 1}`));
    const splits = [
      [33.33, 33.33, 33.34],
      [0.01, 99.99],
      [100, 0],
      [0, 0, 100],
      [16.66, 16.66, 16.67, 16.67, 16.67, 16.67],
      ...Array.from({ length: 150 }, (_, index) => randomPercentages(next, 1 + (index % 6))),
    ];

    splits.forEach((percentages) => {
      const groupMembers = members.slice(0, percentages.length);
      const shares = Object.fromEntries(groupMembers.map((m, i) => [m.id, percentages[i] ?? 0]));
      const split = { splitType: SplitType.PERCENTAGE, shares };
      assert.equal(defaultSplitSchema.safeParse(split).success, true);
      assert.equal(
        getDefaultSplitError(
          split,
          groupMembers.map((m) => m.id),
        ),
        undefined,
      );

      AMOUNTS.forEach((amount) => {
        useAddExpenseStore.setState({ currentUser: members[0], preferredCurrency: 'INR' });
        state().actions.resetState();
        state().actions.selectGroup(group(split), groupMembers);
        state().actions.setAmount(amount);
        const label = `${percentages.join('/')} of ${amount}`;
        assert.equal(state().splitType, SplitType.PERCENTAGE, label);
        assert.equal(state().canSplitScreenClosed, true, label);

        const participants = getParticipantsToSave(state()).map((p) => ({
          userId: p.id,
          amount: p.amount ?? 0,
        }));
        assert.deepEqual(
          toBalancedParticipants(amount, members[0]!.id, participants, SplitType.PERCENTAGE),
          participants,
          label,
        );
      });
    });
  });
});

void describe('a split changed by hand and pending invites', () => {
  const bob = user(4, 'Bob');
  const invite = () => {
    let settle: { resolve: (u: User) => void; reject: (e: Error) => void } | undefined;
    const pending = inviteParticipant(
      'bob@example.com',
      () => new Promise<User>((resolve, reject) => (settle = { resolve, reject })),
    );
    const placeholder = state().participants.find((p) => 0 > p.id);
    assert.ok(placeholder && settle);
    return { pending, placeholder, settle };
  };
  const sixtyForty = group({ splitType: SplitType.PERCENTAGE, shares: { 1: 60, 4: 40 } });

  void it('keeps the share given to an invite once it returns their account', async () => {
    start();
    state().actions.setAmount(100);
    state().actions.setSplitType(SplitType.SHARE);
    const { pending, placeholder, settle } = invite();
    state().actions.addOrUpdateParticipant({ ...state().participants[0]!, splitShare: 1 });
    state().actions.addOrUpdateParticipant({ ...placeholder, splitShare: 3 });
    settle.resolve(bob);
    await pending;
    assert.deepEqual(state().manualSplit, { splitType: 'SHARE', shares: { 1: 1, 4: 3 } });

    state().actions.selectGroup(sixtyForty, [me, bob]);

    assert.equal(state().splitType, SplitType.SHARE);
    assert.deepEqual(amounts(), [
      [1, 75],
      [4, -75],
    ]);
    assert.equal(state().canSplitScreenClosed, true);
  });

  void it('drops the share of an invite that failed', async () => {
    start();
    state().actions.setAmount(100);
    state().actions.setSplitType(SplitType.SHARE);
    const { pending, placeholder, settle } = invite();
    state().actions.addOrUpdateParticipant({ ...placeholder, splitShare: 3 });
    settle.reject(new Error('no'));
    await assert.rejects(pending);
    assert.deepEqual(state().manualSplit?.shares, { 1: 1 });

    state().actions.removeParticipant(me.id);
    assert.deepEqual(state().manualSplit?.shares, {});
  });

  void it('keeps their own share when the invite returns someone already in the split', async () => {
    start();
    state().actions.setAmount(100);
    state().actions.setSplitType(SplitType.SHARE);
    state().actions.addOrUpdateParticipant(bob);
    state().actions.addOrUpdateParticipant({ ...state().participants[0]!, splitShare: 1 });
    state().actions.addOrUpdateParticipant({ ...state().participants[1]!, splitShare: 2 });
    const { pending, placeholder, settle } = invite();
    state().actions.addOrUpdateParticipant({ ...placeholder, splitShare: 5 });
    settle.resolve(bob);
    await pending;
    assert.deepEqual(state().manualSplit?.shares, { 1: 1, 4: 2 });

    state().actions.selectGroup(sixtyForty, [me, bob]);

    assert.deepEqual(amounts(), [
      [1, 66.67],
      [4, -66.67],
    ]);
  });
});
