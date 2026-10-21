import { Expo, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import { env } from '~/env';
import { db } from '~/server/db';
import {
  type NativePushData,
  type PendingPushReceipt,
  buildExpoPushMessages,
  readPushReceipts,
  readPushTickets,
} from '~/utils/expoPush';

/** Expo suggests waiting this long before asking how delivery went. */
const RECEIPT_DELAY_MS = 15 * 60_000;

export const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN });

const logErrors = (results: Array<ExpoPushTicket | ExpoPushReceipt>) =>
  results.forEach((result) => {
    if ('error' === result.status) {
      console.error('Expo push error', result.message, result.details);
    }
  });

/** Leaves tokens registered again since the send alone, the app is back on that device. */
const deleteTokens = async (tokens: string[], sentAt: Date) => {
  if (0 === tokens.length) {
    return;
  }

  await db.devicePushToken.deleteMany({
    where: { token: { in: tokens }, updatedAt: { lt: sentAt } },
  });
};

/**
 * The users' device tokens. Tokens whose app session expired are skipped and deleted: that app is
 * signed out, even if it never got to tell us.
 */
export const getDevicePushTokens = async (userIds: number[]) => {
  const devices = await db.devicePushToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, token: true, session: { select: { expires: true } } },
  });
  const now = new Date();
  const isExpired = (device: (typeof devices)[number]) =>
    !!device.session && device.session.expires < now;
  const expiredIds = devices.filter(isExpired).map((device) => device.id);

  if (0 < expiredIds.length) {
    // Rechecked, in case the token was registered again by a live session meanwhile
    await db.devicePushToken
      .deleteMany({ where: { id: { in: expiredIds }, session: { expires: { lt: now } } } })
      .catch((error) => console.error('Error deleting expired Expo push tokens', error));
  }

  return devices.filter((device) => !isExpired(device)).map((device) => device.token);
};

export const checkReceipts = async (pending: PendingPushReceipt[], sentAt: Date) => {
  const chunks = expo.chunkPushNotificationReceiptIds(pending.map((receipt) => receipt.id));
  const unregistered = await Promise.all(
    chunks.map(async (ids) => {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(ids);
        logErrors(Object.values(receipts));
        return readPushReceipts(pending, receipts);
      } catch (error) {
        console.error('Error fetching Expo push receipts', error);
        return [];
      }
    }),
  );

  await deleteTokens(unregistered.flat(), sentAt);
};

/** Sends to the native app and forgets tokens Expo says were unregistered. Never throws. */
export const sendExpoPushNotifications = async (tokens: string[], data: NativePushData) => {
  if (0 === tokens.length) {
    return;
  }

  const sentAt = new Date();
  const chunks = expo.chunkPushNotifications(buildExpoPushMessages(tokens, data));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        logErrors(tickets);
        return readPushTickets(
          chunk.flatMap((message) => message.to),
          tickets,
        );
      } catch (error) {
        console.error('Error sending Expo push notifications', error);
        return { unregistered: [], receipts: [] };
      }
    }),
  );

  try {
    await deleteTokens(
      results.flatMap((result) => result.unregistered),
      sentAt,
    );
  } catch (error) {
    console.error('Error deleting unregistered Expo push tokens', error);
  }

  const pending = results.flatMap((result) => result.receipts);
  if (0 < pending.length) {
    setTimeout(() => {
      checkReceipts(pending, sentAt).catch(console.error);
    }, RECEIPT_DELAY_MS).unref();
  }
};
