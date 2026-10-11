import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { SplitType, type User } from '@prisma/client';

import {
  type Participant,
  getEditFormState,
  getParticipantsToSave,
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
const storeCents = () => toCents(useAddExpenseStore.getState().participants);
const savedCents = () => toCents(getParticipantsToSave(useAddExpenseStore.getState()));

const SPLIT_TYPES = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.SHARE,
  SplitType.EXACT,
  SplitType.ADJUSTMENT,
];

// Small deterministic PRNG, so a failing case can be reproduced from its seed.
const createRandom = (seed: number) => {
  let state = (seed + 7919) >>> 0;
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

type StoredExpense = {
  amountCents: number;
  splitType: SplitType;
  payer: User;
  rows: Array<{ user: User; amount: number }>;
};

/**
 * A stored expense as any earlier client may have saved it: the remainder cents on any participant,
 * arbitrary shares, and for some a payer row that is off by up to n - 1 cents (rows rounded one by
 * one), which the server still accepts.
 */
const historicalExpense = (seed: number): StoredExpense => {
  const random = createRandom(seed);
  const users = Array.from({ length: 1 + random.int(6) }, (_, index) => createUser(index + 1));
  const magnitude = [1 + random.int(100), 1 + random.int(100_000), 1 + random.int(2_000_000_000)][
    random.int(3)
  ]!;
  const sign = 0.3 > random.next() ? -1 : 1;
  const payer = users[random.int(users.length)]!;
  const splitType = SPLIT_TYPES[random.int(SPLIT_TYPES.length)]!;

  // What each person owes of the absolute amount.
  const owed = users.map(() => 0);
  if (SplitType.EQUAL === splitType) {
    const included = users.map((_, index) => index).filter(() => 0.8 > random.next());
    const sharing = included.length ? included : [random.int(users.length)];
    const base = Math.floor(magnitude / sharing.length);
    sharing.forEach((index) => (owed[index] = base));
    // The remainder on any of them, not only on the lowest ids as today.
    Array.from({ length: magnitude - base * sharing.length }).forEach(() => {
      const index = sharing[random.int(sharing.length)]!;
      owed[index] = (owed[index] ?? 0) + 1;
    });
  } else {
    let left = magnitude;
    users.forEach((_, index) => {
      const part = index === users.length - 1 ? left : random.int(left + 1);
      owed[index] = part;
      left -= part;
    });
  }

  const drift = 0.5 > random.next() ? 0 : random.int(2 * users.length - 1) - (users.length - 1);
  const rows = users.map((user, index) => {
    const share = sign * (owed[index] ?? 0);
    return {
      user,
      amount: user.id === payer.id ? sign * magnitude - share + drift : 0 - share,
    };
  });

  return { amountCents: sign * magnitude, splitType, payer, rows };
};

const openForEdit = (expense: StoredExpense, currentUser: User = expense.payer) => {
  useAddExpenseStore.getState().actions.resetState();
  useAddExpenseStore.setState({
    ...getEditFormState({
      amount: expense.amountCents,
      splitType: expense.splitType,
      category: 'general',
      currency: 'USD',
      name: 'Stored',
      expenseDate: new Date(),
      fileKey: null,
      group: null,
      paidByUser: expense.payer,
      expenseParticipants: expense.rows,
    }),
    currentUser,
  });
};

afterEach(() => {
  useAddExpenseStore.getState().actions.resetState();
});

void describe('editing an expense saved with an older cent distribution', () => {
  const legacyThirds: StoredExpense = {
    amountCents: 1000,
    splitType: SplitType.EQUAL,
    payer: carol,
    rows: [
      { user: alice, amount: -333 },
      { user: bob, amount: -333 },
      { user: carol, amount: 666 },
    ],
  };

  void it('keeps -333/-333/+666 for 10.00 split equally after equal -> share -> equal', () => {
    openForEdit(legacyThirds, alice);
    const { setSplitType } = useAddExpenseStore.getState().actions;
    setSplitType(SplitType.SHARE);
    setSplitType(SplitType.EQUAL);

    assert.deepEqual(storeCents(), [-333, -333, 666]);
    assert.deepEqual(savedCents(), [-333, -333, 666]);
  });

  void it('keeps the stored cents through split type round trips, the same payer and amount', () => {
    Array.from({ length: 600 }, (_, seed) => seed).forEach((seed) => {
      const expense = historicalExpense(seed);
      const storedCents = expense.rows.map((row) => row.amount + 0);
      const amount = expense.amountCents / 100;
      const { setSplitType, setPaidBy, setAmount, setCurrency } =
        useAddExpenseStore.getState().actions;

      openForEdit(expense);
      assert.deepEqual(storeCents(), storedCents, `seed ${seed} loaded`);
      assert.deepEqual(savedCents(), storedCents, `seed ${seed} saved as loaded`);

      SPLIT_TYPES.filter((splitType) => splitType !== expense.splitType).forEach((splitType) => {
        setSplitType(splitType);
        setSplitType(expense.splitType);
        assert.deepEqual(storeCents(), storedCents, `seed ${seed} via ${splitType}, shown`);
        assert.deepEqual(savedCents(), storedCents, `seed ${seed} via ${splitType}, saved`);
      });

      SPLIT_TYPES.forEach((splitType) => setSplitType(splitType));
      setSplitType(expense.splitType);
      setPaidBy(expense.payer);
      setAmount(amount);
      setCurrency('EUR');
      setCurrency('USD');
      assert.deepEqual(storeCents(), storedCents, `seed ${seed} after every type, shown`);
      assert.deepEqual(savedCents(), storedCents, `seed ${seed} after every type, saved`);

      const other = expense.rows.find((row) => row.user.id !== expense.payer.id)?.user;
      if (other) {
        setPaidBy(other);
        setPaidBy(expense.payer);
        assert.deepEqual(savedCents(), storedCents, `seed ${seed} payer changed and back`);
      }

      setAmount(amount + 1);
      setAmount(amount);
      assert.deepEqual(savedCents(), storedCents, `seed ${seed} amount changed and back`);

      // The server only moves the payer's row, to absorb an old rounding drift.
      const saved = toBalancedParticipants(
        amount,
        expense.payer.id,
        getParticipantsToSave(useAddExpenseStore.getState()).map((participant) => ({
          userId: participant.id,
          amount: participant.amount ?? 0,
        })),
        expense.splitType,
      );
      const drift = storedCents.reduce((total, cents) => total + cents, 0);
      assert.deepEqual(
        saved.map((participant) => toInteger(participant.amount) + 0),
        expense.rows.map((row) => row.amount - (row.user.id === expense.payer.id ? drift : 0) + 0),
        `seed ${seed} server`,
      );
    });
  });

  void it('recalculates once a split value or the participants change', () => {
    openForEdit(legacyThirds, alice);
    const { addOrUpdateParticipant, setSplitType, removeParticipant } =
      useAddExpenseStore.getState().actions;

    setSplitType(SplitType.SHARE);
    const [first] = useAddExpenseStore.getState().participants;
    assert.ok(first);
    // Typing the same value is still an edit.
    addOrUpdateParticipant({ ...first, splitShare: first.splitShare });
    setSplitType(SplitType.EQUAL);
    assert.equal(useAddExpenseStore.getState().editSnapshot, undefined);
    assert.deepEqual(savedCents(), storeCents());
    assert.deepEqual(storeCents(), [-334, -333, 667]);

    openForEdit(legacyThirds, alice);
    removeParticipant(bob.id);
    assert.equal(useAddExpenseStore.getState().editSnapshot, undefined);
    assert.deepEqual(savedCents(), [-500, 500]);
  });

  void it('recalculates while the amount, payer or currency differ from the stored expense', () => {
    openForEdit(legacyThirds, alice);
    const { setAmount, setPaidBy, setCurrency } = useAddExpenseStore.getState().actions;

    setAmount(20);
    assert.deepEqual(savedCents(), storeCents());
    assert.equal(savedCents()[2], 1333);
    setAmount(10);
    setPaidBy(alice);
    assert.deepEqual(savedCents(), storeCents());
    assert.equal(savedCents()[0], 666);
    setPaidBy(carol);
    setCurrency('EUR');
    assert.deepEqual(
      getParticipantsToSave(useAddExpenseStore.getState()),
      useAddExpenseStore.getState().participants,
    );
  });

  void it('never applies to a new expense', () => {
    useAddExpenseStore.getState().actions.setCurrentUser(alice);
    useAddExpenseStore.getState().actions.resetState();
    assert.equal(useAddExpenseStore.getState().editSnapshot, undefined);
  });
});

const startNewForm = () => {
  const { actions } = useAddExpenseStore.getState();
  actions.setCurrentUser(alice);
  actions.resetState();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

void describe('completing an invite', () => {
  void it('keeps the invitee as payer, in place, with their split value', async () => {
    startNewForm();
    const { actions } = useAddExpenseStore.getState();
    actions.addOrUpdateParticipant(carol);
    const invite = deferred<User>();
    const pending = inviteParticipant(bob.email!, () => invite.promise);
    actions.setNameOrEmail('');
    actions.setAmount(100);
    actions.setSplitType(SplitType.SHARE);
    const placeholder = useAddExpenseStore.getState().participants.find((p) => -1 === p.id);
    assert.ok(placeholder);
    actions.addOrUpdateParticipant({ ...placeholder, splitShare: 3 });
    actions.setPaidBy(placeholder);

    invite.resolve(bob);
    await pending;

    const state = useAddExpenseStore.getState();
    assert.equal(state.paidBy?.id, bob.id);
    assert.deepEqual(
      state.participants.map((participant) => [participant.id, participant.splitShare]),
      [
        [alice.id, 1],
        [carol.id, 1],
        [bob.id, 3],
      ],
    );
    assert.deepEqual(storeCents(), [-2000, -2000, 4000]);
    assert.equal(state.canSplitScreenClosed, true);
  });

  void it('saves the invitee as payer when they were picked before the invite returned', async () => {
    startNewForm();
    const { actions } = useAddExpenseStore.getState();
    const invite = deferred<User>();
    const pending = inviteParticipant(bob.email!, () => invite.promise);
    actions.setDescription('Bob paid dinner');
    actions.setAmount(100);
    actions.setPaidBy(useAddExpenseStore.getState().participants.find((p) => -1 === p.id)!);

    invite.resolve(bob);
    await pending;

    assert.equal(useAddExpenseStore.getState().paidBy?.id, bob.id);
    // Alice owes Bob 50.00.
    assert.deepEqual(storeCents(), [-5000, 5000]);
  });

  void it('drops the placeholder when the invitee was already added', async () => {
    startNewForm();
    const { actions } = useAddExpenseStore.getState();
    actions.addOrUpdateParticipant(bob);
    const invite = deferred<User>();
    const pending = inviteParticipant(bob.email!, () => invite.promise);
    actions.setPaidBy(useAddExpenseStore.getState().participants.find((p) => -1 === p.id)!);

    invite.resolve(bob);
    await pending;

    const state = useAddExpenseStore.getState();
    assert.deepEqual(
      state.participants.map((participant) => participant.id),
      [alice.id, bob.id],
    );
    assert.equal(state.paidBy?.id, bob.id);
  });
});

void describe('a receipt that is still being checked when the form is reset', () => {
  void it('marks the upload right away and drops it after a slow image check', async () => {
    startNewForm();
    const decode = deferred<void>();
    let uploadUrlRequested = false;
    const pending = uploadReceipt(
      new File(['receipt'], 'receipt.png', { type: 'image/png' }),
      () => {
        uploadUrlRequested = true;
        return Promise.resolve({ fileUrl: 'https://example.invalid/upload', key: 'old.png' });
      },
      () => decode.promise,
    );
    assert.equal(useAddExpenseStore.getState().isFileUploading, true);

    useAddExpenseStore.getState().actions.resetState();
    useAddExpenseStore.getState().actions.setDescription('Next expense');
    decode.resolve();

    assert.equal(await pending, 'stale');
    assert.equal(uploadUrlRequested, false);
    const state = useAddExpenseStore.getState();
    assert.equal(state.fileKey, undefined);
    assert.equal(state.isFileUploading, false);
    assert.equal(state.description, 'Next expense');
  });
});
