import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { type User } from '@prisma/client';

import { inviteParticipant, isPendingInvite, useAddExpenseStore } from '~/store/addStore';
import { toInteger } from '~/utils/numbers';

const createUser = (id: number, name: string): User => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  emailVerified: null,
  deletedAt: null,
  image: null,
  currency: 'USD',
});

const [alice, bob, carol, dave] = [
  createUser(1, 'Alice'),
  createUser(2, 'Bob'),
  createUser(3, 'Carol'),
  createUser(4, 'Dave'),
] as [User, User, User, User];

const startNewForm = () => {
  const { actions } = useAddExpenseStore.getState();
  actions.setCurrentUser(alice);
  actions.resetState();
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

type Path = 'enter' | 'button';

/**
 * Starts an invite the way each invite path in the add form does: Enter in the people input sends
 * the email in lower case, "Add to Split Pro" sends it as typed. Both go through
 * `inviteParticipant`, the server call only returns when the test settles it.
 */
const startInvite = (path: Path, email: string) => {
  const server = deferred<User>();
  const sent: string[] = [];
  useAddExpenseStore.getState().actions.setNameOrEmail(email);
  const pending = inviteParticipant(email, (input) => {
    sent.push('enter' === path ? input.toLowerCase() : input);
    return server.promise;
  });
  const settled = pending.then(
    () => 'ok',
    (error: Error) => error.message,
  );
  return { server, settled, sent };
};

const participantNames = () =>
  useAddExpenseStore
    .getState()
    .participants.map((participant) =>
      isPendingInvite(participant) ? `pending:${participant.email}` : participant.name,
    );

const storeCents = () =>
  useAddExpenseStore
    .getState()
    .participants.map((participant) => toInteger(participant.amount ?? 0) + 0);

afterEach(() => {
  useAddExpenseStore.getState().actions.resetState();
});

void describe('overlapping invites', () => {
  const orders = [
    { name: 'the first invite returns first', first: 'bob', second: 'carol' },
    { name: 'the second invite returns first', first: 'carol', second: 'bob' },
  ] as const;
  const pathPairs: Array<[Path, Path]> = [
    ['enter', 'button'],
    ['enter', 'enter'],
    ['button', 'button'],
    ['button', 'enter'],
  ];

  pathPairs.forEach(([bobPath, carolPath]) => {
    orders.forEach((order) => {
      void it(`keeps both invitees (${bobPath} then ${carolPath}, ${order.name})`, async () => {
        startNewForm();
        const invites = {
          bob: startInvite(bobPath, bob.email!),
          carol: startInvite(carolPath, carol.email!),
        };
        const placeholders = useAddExpenseStore.getState().participants.filter(isPendingInvite);
        assert.equal(placeholders.length, 2);
        assert.notEqual(placeholders[0]?.id, placeholders[1]?.id);

        invites[order.first].server.resolve('bob' === order.first ? bob : carol);
        assert.equal(await invites[order.first].settled, 'ok');
        assert.equal(useAddExpenseStore.getState().participants.some(isPendingInvite), true);
        invites[order.second].server.resolve('bob' === order.second ? bob : carol);
        assert.equal(await invites[order.second].settled, 'ok');

        assert.deepEqual(participantNames(), ['Alice', 'Bob', 'Carol']);
        const { actions } = useAddExpenseStore.getState();
        actions.setAmount(100);
        assert.deepEqual(storeCents(), [6666, -3333, -3333]);
      });
    });
  });

  orders.forEach((order) => {
    void it(`keeps the invite that succeeds when the other fails (${order.name})`, async () => {
      startNewForm();
      const invites = {
        bob: startInvite('enter', bob.email!),
        carol: startInvite('button', carol.email!),
      };
      const failing = order.first;
      const succeeding = order.second;

      invites[failing].server.reject(new Error('Invite failed'));
      assert.equal(await invites[failing].settled, 'Invite failed');
      assert.deepEqual(participantNames(), ['Alice', `pending:${succeeding}@example.com`]);

      invites[succeeding].server.resolve('bob' === succeeding ? bob : carol);
      assert.equal(await invites[succeeding].settled, 'ok');
      assert.deepEqual(participantNames(), ['Alice', 'bob' === succeeding ? 'Bob' : 'Carol']);
    });
  });

  void it('drops only its own placeholder when the invitee is already a participant', async () => {
    startNewForm();
    useAddExpenseStore.getState().actions.addOrUpdateParticipant(bob);
    const again = startInvite('button', bob.email!);
    const other = startInvite('enter', carol.email!);

    again.server.resolve(bob);
    assert.equal(await again.settled, 'ok');
    assert.deepEqual(participantNames(), ['Alice', 'Bob', 'pending:carol@example.com']);

    other.server.resolve(carol);
    assert.equal(await other.settled, 'ok');
    assert.deepEqual(participantNames(), ['Alice', 'Bob', 'Carol']);
  });

  void it('adds a person once when they are invited twice at the same time', async () => {
    startNewForm();
    const first = startInvite('enter', bob.email!);
    const second = startInvite('button', bob.email!);

    second.server.resolve(bob);
    first.server.resolve(bob);
    await Promise.all([first.settled, second.settled]);

    assert.deepEqual(participantNames(), ['Alice', 'Bob']);
  });

  void it('does not bring back a pending invitee the user removed', async () => {
    startNewForm();
    const kept = startInvite('enter', bob.email!);
    const removed = startInvite('button', carol.email!);
    useAddExpenseStore.getState().actions.removeLastParticipant();

    removed.server.resolve(carol);
    kept.server.resolve(bob);
    await Promise.all([kept.settled, removed.settled]);

    assert.deepEqual(participantNames(), ['Alice', 'Bob']);
  });

  void it('keeps an email typed for the next invite when an earlier one returns', async () => {
    startNewForm();
    const invite = startInvite('enter', bob.email!);
    useAddExpenseStore.getState().actions.setNameOrEmail(dave.email!);

    invite.server.resolve(bob);
    await invite.settled;
    assert.equal(useAddExpenseStore.getState().nameOrEmail, dave.email);

    const next = startInvite('button', dave.email!);
    next.server.resolve(dave);
    await next.settled;
    assert.equal(useAddExpenseStore.getState().nameOrEmail, '');
  });

  void it('keeps a payer picked while their invite was pending, next to another invite', async () => {
    startNewForm();
    const bobInvite = startInvite('enter', bob.email!);
    const carolInvite = startInvite('button', carol.email!);
    const { actions } = useAddExpenseStore.getState();
    const bobPlaceholder = useAddExpenseStore
      .getState()
      .participants.find((participant) => bob.email === participant.email)!;
    actions.setPaidBy(bobPlaceholder);

    carolInvite.server.resolve(carol);
    await carolInvite.settled;
    assert.equal(useAddExpenseStore.getState().paidBy?.id, bobPlaceholder.id);
    bobInvite.server.resolve(bob);
    await bobInvite.settled;

    assert.equal(useAddExpenseStore.getState().paidBy?.id, bob.id);
    assert.deepEqual(participantNames(), ['Alice', 'Bob', 'Carol']);
  });
});

void describe('invites for a cancelled form', () => {
  (['enter', 'button'] as const).forEach((path) => {
    void it(`drops a ${path} invite that returns after Cancel`, async () => {
      startNewForm();
      const invite = startInvite(path, bob.email!);
      startNewForm();
      assert.deepEqual(participantNames(), ['Alice']);

      invite.server.resolve(bob);
      assert.equal(await invite.settled, 'ok');
      assert.deepEqual(participantNames(), ['Alice']);
    });

    void it(`ignores a ${path} invite that fails after Cancel`, async () => {
      startNewForm();
      const invite = startInvite(path, bob.email!);
      startNewForm();
      useAddExpenseStore.getState().actions.addOrUpdateParticipant(carol);

      invite.server.reject(new Error('Invite failed'));
      assert.equal(await invite.settled, 'ok');
      assert.deepEqual(participantNames(), ['Alice', 'Carol']);
    });
  });

  void it('sends the email the way each path did before', () => {
    startNewForm();
    assert.deepEqual(startInvite('enter', 'Bob@Example.com').sent, ['bob@example.com']);
    assert.deepEqual(startInvite('button', 'Bob@Example.com').sent, ['Bob@Example.com']);
  });
});
