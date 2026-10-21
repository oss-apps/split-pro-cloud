import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildExpoPushMessages,
  getExpensePushUrl,
  isValidExpoPushToken,
  readPushReceipts,
  readPushTickets,
} from '~/utils/expoPush';

const tokenA = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const tokenB = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const tokenC = 'ExpoPushToken[cccccccccccccccccccccc]';

const unregistered = (expoPushToken?: string) =>
  ({
    status: 'error',
    message: 'not a registered push notification recipient',
    details: { error: 'DeviceNotRegistered', expoPushToken },
  }) as const;

void describe('isValidExpoPushToken', () => {
  void it('should accept Expo push tokens', () => {
    assert.ok(isValidExpoPushToken(tokenA));
    assert.ok(isValidExpoPushToken(tokenC));
  });

  void it('should reject anything else', () => {
    ['', 'ExponentPushToken[', 'abc', 'fcm:token', JSON.stringify({ endpoint: 'x' })].forEach(
      (token) => assert.equal(isValidExpoPushToken(token), false, token),
    );
  });
});

void describe('getExpensePushUrl', () => {
  void it('should open the expense', () => {
    assert.equal(getExpensePushUrl({ id: 'e1', groupId: 5, deletedBy: null }), '/expenses/e1');
    assert.equal(getExpensePushUrl({ id: 'e1', groupId: null, deletedBy: null }), '/expenses/e1');
  });

  void it('should open where a deleted expense was', () => {
    assert.equal(getExpensePushUrl({ id: 'e1', groupId: 5, deletedBy: 2 }), '/groups/5');
    assert.equal(getExpensePushUrl({ id: 'e1', groupId: null, deletedBy: 2 }), '/activity');
  });
});

void describe('buildExpoPushMessages', () => {
  void it('should send the web notification text to each token with its link', () => {
    const messages = buildExpoPushMessages([tokenA, tokenB], {
      title: 'Alice',
      message: 'Alice paid  USD 10 for Lunch',
      url: '/expenses/e1',
    });

    assert.deepEqual(messages, [
      {
        to: tokenA,
        title: 'Alice',
        body: 'Alice paid  USD 10 for Lunch',
        data: { url: '/expenses/e1' },
        sound: 'default',
      },
      {
        to: tokenB,
        title: 'Alice',
        body: 'Alice paid  USD 10 for Lunch',
        data: { url: '/expenses/e1' },
        sound: 'default',
      },
    ]);
  });
});

void describe('readPushTickets', () => {
  void it('should pick unregistered tokens and keep receipts for the rest', () => {
    const result = readPushTickets(
      [tokenA, tokenB, tokenC],
      [
        { status: 'ok', id: 'r1' },
        unregistered(),
        { status: 'error', message: 'Too fast', details: { error: 'MessageRateExceeded' } },
      ],
    );

    assert.deepEqual(result, { unregistered: [tokenB], receipts: [{ id: 'r1', token: tokenA }] });
  });

  void it('should prefer the token Expo names in the error', () => {
    assert.deepEqual(readPushTickets([tokenA], [unregistered(tokenC)]).unregistered, [tokenC]);
  });
});

void describe('readPushReceipts', () => {
  void it('should pick tokens whose receipt says the device is unregistered', () => {
    const pending = [
      { id: 'r1', token: tokenA },
      { id: 'r2', token: tokenB },
      { id: 'r3', token: tokenC },
    ];

    assert.deepEqual(
      readPushReceipts(pending, {
        r1: { status: 'ok' },
        r2: unregistered(),
        // r3 isn't ready yet
      }),
      [tokenB],
    );
  });
});
