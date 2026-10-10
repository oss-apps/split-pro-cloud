import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SplitType } from '@prisma/client';

import {
  buildSettleUpPayment,
  getDefaultSelection,
  getSettleUpDestinations,
  getSettleableCurrencies,
  resolveSelection,
} from '~/utils/settleUp';

const ALICE = 1;
const BOB = 2;
const TRIP = 10;
const FLAT = 11;
const OLD = 12;

const group = (groupId: number, amount: number, canSettle = true) => ({
  groupId,
  name: canSettle ? `Group ${groupId}` : null,
  amount,
  canSettle,
});

// Bob owes Alice 10 in the trip, Alice owes Bob 10 in the flat and Bob owes Alice 5 outside groups.
const offsetting = {
  currency: 'USD',
  total: 500,
  nonGroup: 500,
  groups: [group(TRIP, 1000), group(FLAT, -1000)],
};

void describe('getSettleUpDestinations', () => {
  void it('offers all balances and each group, but no separate non-group payment', () => {
    const destinations = getSettleUpDestinations(offsetting);

    assert.deepEqual(
      destinations.map((d) => [d.id, d.amount, d.disabled]),
      [
        ['all', 500, false],
        [TRIP, 1000, false],
        [FLAT, -1000, false],
      ],
    );
  });

  void it('does not offer all balances when the groups cancel out overall', () => {
    const destinations = getSettleUpDestinations({ ...offsetting, total: 0, nonGroup: 0 });

    assert.deepEqual(
      destinations.map((d) => d.id),
      [TRIP, FLAT],
    );
  });

  void it('shows groups the caller cannot settle as disabled', () => {
    const destinations = getSettleUpDestinations({
      currency: 'USD',
      total: 200,
      nonGroup: 0,
      groups: [group(OLD, 200, false)],
    });

    assert.deepEqual(
      destinations.map((d) => [d.id, d.disabled]),
      [
        ['all', false],
        [OLD, true],
      ],
    );
  });
});

void describe('getSettleableCurrencies', () => {
  void it('keeps currencies that only have group balances', () => {
    const currencies = getSettleableCurrencies([
      { currency: 'USD', total: 0, nonGroup: 0, groups: [group(TRIP, 1000), group(FLAT, -1000)] },
      { currency: 'EUR', total: 100, nonGroup: 100, groups: [] },
      { currency: 'GBP', total: 0, nonGroup: -300, groups: [group(OLD, 300, false)] },
    ]);

    assert.deepEqual(
      currencies.map((c) => c.currency),
      ['USD', 'EUR'],
    );
  });
});

void describe('getDefaultSelection', () => {
  void it('picks all balances when it is offered', () => {
    assert.deepEqual(getDefaultSelection(getSettleUpDestinations(offsetting)), {
      id: 'all',
      amount: 500,
    });
  });

  void it('picks the only group when the total is zero', () => {
    const destinations = getSettleUpDestinations({
      currency: 'USD',
      total: 0,
      nonGroup: -1000,
      groups: [group(TRIP, 1000), group(OLD, -500, false)],
    });

    assert.deepEqual(getDefaultSelection(destinations), { id: TRIP, amount: 1000 });
  });

  void it('asks the user to choose between groups when the total is zero', () => {
    const destinations = getSettleUpDestinations({ ...offsetting, total: 0, nonGroup: 0 });

    assert.equal(getDefaultSelection(destinations), undefined);
  });
});

void describe('resolveSelection', () => {
  const selection = { id: TRIP, amount: 1000 };

  void it('uses the latest amount of the selected group', () => {
    const resolved = resolveSelection(
      getSettleUpDestinations({ ...offsetting, groups: [group(TRIP, 400), group(FLAT, -1000)] }),
      selection,
    );

    assert.equal(resolved.status, 'ok');
    assert.deepEqual(
      'ok' === resolved.status && [resolved.destination.id, resolved.destination.amount],
      [TRIP, 400],
    );
  });

  void it('is stale when the selected group is gone, instead of falling back to all balances', () => {
    const resolved = resolveSelection(
      getSettleUpDestinations({ ...offsetting, total: -500, groups: [group(FLAT, -1000)] }),
      selection,
    );

    assert.deepEqual(resolved, { status: 'stale' });
  });

  void it('is stale when the selected group can no longer be settled', () => {
    const resolved = resolveSelection(
      getSettleUpDestinations({ ...offsetting, groups: [group(TRIP, 1000, false)] }),
      selection,
    );

    assert.deepEqual(resolved, { status: 'stale' });
  });

  void it('is stale when the selected group now goes the other way', () => {
    const resolved = resolveSelection(
      getSettleUpDestinations({ ...offsetting, groups: [group(TRIP, -300), group(FLAT, -1000)] }),
      selection,
    );

    assert.deepEqual(resolved, { status: 'stale' });
  });

  void it('is stale when all balances is no longer offered or flips', () => {
    const all = { id: 'all' as const, amount: 500 };

    assert.deepEqual(resolveSelection(getSettleUpDestinations({ ...offsetting, total: 0 }), all), {
      status: 'stale',
    });
    assert.deepEqual(
      resolveSelection(getSettleUpDestinations({ ...offsetting, total: -200 }), all),
      { status: 'stale' },
    );
  });

  void it('has nothing to pay without a selection', () => {
    assert.deepEqual(resolveSelection(getSettleUpDestinations(offsetting), undefined), {
      status: 'none',
    });
  });
});

void describe('buildSettleUpPayment', () => {
  const [all, trip, flat] = getSettleUpDestinations(offsetting);

  void it('pays all balances as a personal settlement', () => {
    const settlement = buildSettleUpPayment({
      destination: all!,
      currency: 'USD',
      value: 5,
      currentUserId: ALICE,
      friendId: BOB,
    });

    assert.deepEqual(settlement, {
      kind: 'personal',
      payment: {
        name: 'Settle up',
        currency: 'USD',
        amount: 5,
        splitType: SplitType.SETTLEMENT,
        participants: [
          { userId: ALICE, amount: -5 },
          { userId: BOB, amount: 5 },
        ],
        paidBy: BOB,
        category: 'general',
      },
    });
  });

  void it('pays a group in the direction of that group', () => {
    const toAlice = buildSettleUpPayment({
      destination: trip!,
      currency: 'USD',
      value: 10,
      currentUserId: ALICE,
      friendId: BOB,
    });
    const toBob = buildSettleUpPayment({
      destination: flat!,
      currency: 'USD',
      value: 10,
      currentUserId: ALICE,
      friendId: BOB,
    });

    assert.equal(toAlice.kind, 'group');
    assert.equal('group' === toAlice.kind && toAlice.payment.groupId, TRIP);
    assert.equal(toAlice.payment.paidBy, BOB);
    assert.equal(toBob.kind, 'group');
    assert.equal('group' === toBob.kind && toBob.payment.groupId, FLAT);
    assert.equal(toBob.payment.paidBy, ALICE);
    assert.deepEqual(toBob.payment.participants, [
      { userId: ALICE, amount: 10 },
      { userId: BOB, amount: -10 },
    ]);
  });
});
