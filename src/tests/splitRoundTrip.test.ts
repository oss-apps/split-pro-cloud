import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SplitType, type User } from '@prisma/client';

import {
  type Participant,
  calculateParticipantSplit,
  calculateSplitShareBasedOnAmount,
  getEditFormState,
  inviteParticipant,
  uploadReceipt,
  useAddExpenseStore,
} from '~/store/addStore';
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

const [alice, bob, carol] = [createUser(1), createUser(2), createUser(3)] as [User, User, User];
// `+ 0` turns -0 into 0, so a zero share compares equal whatever its sign.
const toCents = (participants: Participant[]) =>
  participants.map((participant) => toInteger(participant.amount ?? 0) + 0);

const SPLIT_TYPES = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.SHARE,
  SplitType.EXACT,
  SplitType.ADJUSTMENT,
];
// Every allocation can be expressed by these. Equal only expresses equal splits.
const LOSSLESS_TYPES = [
  SplitType.PERCENTAGE,
  SplitType.SHARE,
  SplitType.EXACT,
  SplitType.ADJUSTMENT,
];

// Small deterministic PRNG, so a failing case can be reproduced from its seed.
const createRandom = (seed: number) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (max: number) => Math.floor(next() * max);
  return { next, int };
};

/** Splits `total` into `count` random non-negative parts. */
const randomParts = (random: ReturnType<typeof createRandom>, total: number, count: number) => {
  const cuts = Array.from({ length: count - 1 }, () => random.int(total + 1)).sort((a, b) => a - b);
  return [...cuts, total].map((cut, index) => cut - (index ? cuts[index - 1] ?? 0 : 0));
};

const randomExpense = (seed: number) => {
  const random = createRandom(seed);
  const users = Array.from({ length: 1 + random.int(6) }, (_, index) => createUser(index + 1));
  const magnitude = [1 + random.int(100), 1 + random.int(100_000), 1 + random.int(2_000_000_000)][
    random.int(3)
  ]!;
  const totalCents = magnitude * (0.3 > random.next() ? -1 : 1);
  const absCents = Math.abs(totalCents);
  const payer = users[random.int(users.length)]!;
  const splitType = SPLIT_TYPES[random.int(SPLIT_TYPES.length)]!;

  const shares = (() => {
    switch (splitType) {
      case SplitType.EQUAL: {
        const included = users.map(() => (0.25 > random.next() ? 0 : 1));
        included[random.int(users.length)] = 1;
        return included;
      }
      case SplitType.PERCENTAGE:
        return randomParts(random, 10_000, users.length).map((hundredths) => hundredths / 100);
      case SplitType.SHARE: {
        const values = users.map(() => random.int(8) / (0.5 > random.next() ? 1 : 2));
        values[random.int(users.length)] = 1 + random.int(5);
        return values;
      }
      case SplitType.EXACT:
        return randomParts(random, absCents, users.length).map((cents) => cents / 100);
      default:
        return randomParts(random, random.int(absCents + 1), users.length + 1)
          .slice(0, users.length)
          .map((cents) => cents / 100);
    }
  })();

  const amount = totalCents / 100;
  const { participants, canSplitScreenClosed } = calculateParticipantSplit(
    amount,
    users.map((user, index) => ({ ...user, splitShare: shares[index] })),
    splitType,
    payer,
  );

  return { amount, payer, splitType, participants, canSplitScreenClosed, users };
};

const loadForm = (state: {
  amount: number;
  payer: User;
  splitType: SplitType;
  participants: Participant[];
}) => {
  useAddExpenseStore.getState().actions.resetState();
  useAddExpenseStore.setState({
    currentUser: state.payer,
    paidBy: state.payer,
    amount: state.amount,
    splitType: state.splitType,
    participants: state.participants,
  });
};

const storeCents = () => toCents(useAddExpenseStore.getState().participants);

afterEach(() => {
  useAddExpenseStore.getState().actions.resetState();
});

void describe('split inputs rebuilt from amounts', () => {
  void it('keeps a 3:7 share split as whole shares and the same cents', () => {
    [100, 1000, -1000].forEach((amount) => {
      const original = calculateParticipantSplit(
        amount,
        [
          { ...alice, splitShare: 3 },
          { ...bob, splitShare: 7 },
        ],
        SplitType.SHARE,
        alice,
      );
      const rebuilt = calculateSplitShareBasedOnAmount(
        amount,
        original.participants,
        SplitType.SHARE,
        alice,
      );

      assert.deepEqual(
        rebuilt.map((participant) => participant.splitShare),
        [3, 7],
      );
      assert.deepEqual(
        toCents(calculateParticipantSplit(amount, rebuilt, SplitType.SHARE, alice).participants),
        toCents(original.participants),
      );
    });
  });

  void it('converts 1,000.00 split equally three ways to percentages without losing cents', () => {
    [1000, -1000].forEach((amount) => {
      const equal = calculateParticipantSplit(
        amount,
        [alice, bob, carol].map((user) => ({ ...user, splitShare: 1 })),
        SplitType.EQUAL,
        alice,
      );
      const rebuilt = calculateSplitShareBasedOnAmount(
        amount,
        equal.participants,
        SplitType.PERCENTAGE,
        alice,
      );
      const result = calculateParticipantSplit(amount, rebuilt, SplitType.PERCENTAGE, alice);

      assert.deepEqual(
        toCents(equal.participants),
        0 < amount ? [66666, -33333, -33333] : [-66666, 33333, 33333],
      );
      assert.equal(result.canSplitScreenClosed, true);
      assert.deepEqual(toCents(result.participants), toCents(equal.participants));
    });
  });

  void it('rebuilds every random allocation to the cent in each lossless split type', () => {
    Array.from({ length: 400 }, (_, seed) => seed).forEach((seed) => {
      const expense = randomExpense(seed);
      assert.equal(expense.canSplitScreenClosed, true, `seed ${seed}`);

      [...LOSSLESS_TYPES, expense.splitType].forEach((splitType) => {
        const rebuilt = calculateSplitShareBasedOnAmount(
          expense.amount,
          expense.participants,
          splitType,
          expense.payer,
        );
        const result = calculateParticipantSplit(expense.amount, rebuilt, splitType, expense.payer);

        assert.equal(result.canSplitScreenClosed, true, `seed ${seed} ${splitType}`);
        assert.deepEqual(
          toCents(result.participants),
          toCents(expense.participants),
          `seed ${seed} ${expense.splitType} -> ${splitType}`,
        );
      });
    });
  });

  void it('keeps the cents when toggling split types and back, or picking the same payer', () => {
    Array.from({ length: 400 }, (_, seed) => seed).forEach((seed) => {
      const expense = randomExpense(seed);
      const original = toCents(expense.participants);
      const random = createRandom(seed + 10_000);
      const { setSplitType, setPaidBy, setSplitScreenOpen } = useAddExpenseStore.getState().actions;

      loadForm(expense);
      setPaidBy(expense.payer);
      setSplitScreenOpen(true);
      setSplitScreenOpen(false);
      assert.deepEqual(storeCents(), original, `seed ${seed} same payer`);

      const switches = Array.from(
        { length: 1 + random.int(4) },
        () => SPLIT_TYPES[random.int(SPLIT_TYPES.length)]!,
      );
      switches.forEach((splitType) => setSplitType(splitType));
      setSplitType(expense.splitType);

      assert.deepEqual(
        storeCents(),
        original,
        `seed ${seed} ${[expense.splitType, ...switches, expense.splitType].join(' -> ')}`,
      );
    });
  });

  void it('opens a stored expense with the stored cents and saves them unchanged', () => {
    Array.from({ length: 200 }, (_, seed) => seed).forEach((seed) => {
      const expense = randomExpense(seed);
      const stored = toBalancedParticipants(
        expense.amount,
        expense.payer.id,
        expense.participants.map((participant) => ({
          userId: participant.id,
          amount: participant.amount ?? 0,
        })),
        expense.splitType,
      );
      const storedCents = stored.map((participant) => toInteger(participant.amount) + 0);
      const form = getEditFormState({
        amount: toInteger(expense.amount),
        splitType: expense.splitType,
        category: 'general',
        currency: 'USD',
        name: 'Stored',
        expenseDate: new Date(),
        fileKey: null,
        group: null,
        paidByUser: expense.payer,
        expenseParticipants: stored.map((participant) => ({
          amount: toInteger(participant.amount),
          user: createUser(participant.userId),
        })),
      });

      useAddExpenseStore.getState().actions.resetState();
      useAddExpenseStore.setState({ ...form, currentUser: expense.payer });
      assert.deepEqual(storeCents(), storedCents, `seed ${seed} as loaded`);

      const { setPaidBy, setSplitType } = useAddExpenseStore.getState().actions;
      setPaidBy(expense.payer);
      setSplitType(SplitType.EQUAL);
      setSplitType(expense.splitType);

      const saved = toBalancedParticipants(
        expense.amount,
        expense.payer.id,
        useAddExpenseStore.getState().participants.map((participant) => ({
          userId: participant.id,
          amount: participant.amount ?? 0,
        })),
        expense.splitType,
      );
      assert.deepEqual(
        saved.map((participant) => toInteger(participant.amount) + 0),
        storedCents,
        `seed ${seed} saved`,
      );
    });
  });

  void it('adds the implied payer row when a stored expense lacks it', () => {
    const form = getEditFormState({
      amount: 3000,
      splitType: SplitType.EQUAL,
      category: 'general',
      currency: 'USD',
      name: 'Old',
      expenseDate: new Date(),
      fileKey: null,
      group: null,
      paidByUser: alice,
      expenseParticipants: [
        { amount: -1000, user: bob },
        { amount: -1000, user: carol },
      ],
    });

    assert.deepEqual(
      form.participants.map((participant) => [participant.id, toInteger(participant.amount ?? 0)]),
      [
        [2, -1000],
        [3, -1000],
        [1, 2000],
      ],
    );
  });
});

void describe('payer stays a participant', () => {
  void it('falls back to the current user when the group with the payer is removed', () => {
    useAddExpenseStore.getState().actions.resetState();
    useAddExpenseStore.setState({
      currentUser: alice,
      paidBy: bob,
      amount: 30,
      group: { id: 1 } as never,
      participants: [alice, bob, carol].map((user) => ({ ...user, splitShare: 1 })),
    });
    const { setGroup, setParticipants, addOrUpdateParticipant } =
      useAddExpenseStore.getState().actions;

    setGroup(undefined);
    setParticipants([alice]);
    addOrUpdateParticipant(carol);

    const { paidBy, participants } = useAddExpenseStore.getState();
    assert.equal(paidBy?.id, alice.id);
    assert.deepEqual(toCents(participants), [1500, -1500]);
  });

  void it('falls back to the current user when the payer is removed', () => {
    useAddExpenseStore.getState().actions.resetState();
    useAddExpenseStore.setState({
      currentUser: alice,
      paidBy: bob,
      amount: 30,
      participants: [alice, bob, carol].map((user) => ({ ...user, splitShare: 1 })),
    });

    useAddExpenseStore.getState().actions.removeParticipant(bob.id);
    assert.equal(useAddExpenseStore.getState().paidBy?.id, alice.id);
  });

  void it('ignores picking a payer who is not a participant', () => {
    loadForm({ amount: 30, payer: alice, splitType: SplitType.EQUAL, participants: [alice] });
    useAddExpenseStore.getState().actions.setPaidBy(bob);
    assert.equal(useAddExpenseStore.getState().paidBy?.id, alice.id);
  });
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const startNewForm = () => {
  const { resetState, setCurrentUser } = useAddExpenseStore.getState().actions;
  setCurrentUser(alice);
  resetState();
};

void describe('async results for an earlier form', () => {
  void it('drops an invite that returns after the form was reset', async () => {
    startNewForm();
    const invite = deferred<User>();
    const pending = inviteParticipant('pending@example.com', () => invite.promise);
    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.id),
      [alice.id, -1],
    );

    startNewForm();
    useAddExpenseStore.getState().actions.addOrUpdateParticipant(carol);
    invite.resolve(bob);
    await pending;

    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.id),
      [alice.id, carol.id],
    );
  });

  void it('replaces the placeholder with the invited user, or removes it if the invite fails', async () => {
    startNewForm();
    await inviteParticipant('bob@example.com', () => Promise.resolve(bob));
    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.id),
      [alice.id, bob.id],
    );

    await assert.rejects(
      inviteParticipant('nope@example.com', () => Promise.reject(new Error('Invite failed'))),
      /Invite failed/,
    );
    assert.deepEqual(
      useAddExpenseStore.getState().participants.map((participant) => participant.id),
      [alice.id, bob.id],
    );
  });

  void it('aborts an upload when the form is reset and keeps its receipt off the next form', async () => {
    const originalFetch = globalThis.fetch;
    let signal: AbortSignal | undefined;
    const upload = deferred<Response>();
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return upload.promise;
    }) as typeof fetch;

    try {
      startNewForm();
      const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
      const pending = uploadReceipt(file, () =>
        Promise.resolve({ fileUrl: 'https://example.invalid/upload', key: 'old-receipt.png' }),
      );
      await Promise.resolve();
      await Promise.resolve();
      assert.equal(useAddExpenseStore.getState().isFileUploading, true);

      startNewForm();
      useAddExpenseStore.getState().actions.setFileUploading(true);
      assert.equal(signal?.aborted, true);

      upload.resolve(new Response(null, { status: 200 }));
      assert.equal(await pending, 'stale');

      const { fileKey, isFileUploading } = useAddExpenseStore.getState();
      assert.equal(fileKey, undefined);
      // The new form's own upload state is left alone.
      assert.equal(isFileUploading, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  void it('sets the receipt of the current form', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch;

    try {
      startNewForm();
      const file = new File(['receipt'], 'receipt.png', { type: 'image/png' });
      const result = await uploadReceipt(file, () =>
        Promise.resolve({ fileUrl: 'https://example.invalid/upload', key: 'receipt.png' }),
      );

      assert.equal(result, 'uploaded');
      assert.equal(useAddExpenseStore.getState().fileKey, 'receipt.png');
      assert.equal(useAddExpenseStore.getState().isFileUploading, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
