import {
  Expo,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from 'expo-server-sdk';

/** A notification as the app shows it, `url` being the in-app path it opens. */
export type NativePushData = { title: string; message: string; url: string };

export type PendingPushReceipt = { id: string; token: string };

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

export const isValidExpoPushToken = (token: string) => Expo.isExpoPushToken(token);

/** Where an expense notification opens: the expense, or once it's deleted, where it was. */
export const getExpensePushUrl = (expense: {
  id: string;
  groupId: number | null;
  deletedBy: number | null;
}) => {
  if (null === expense.deletedBy) {
    return `/expenses/${expense.id}`;
  }

  return null === expense.groupId ? '/activity' : `/groups/${expense.groupId}`;
};

/** One message per token, so every ticket Expo returns belongs to the token at its index. */
export const buildExpoPushMessages = (tokens: string[], data: NativePushData): ExpoPushMessage[] =>
  tokens.map((to) => ({
    to,
    title: data.title,
    body: data.message,
    data: { url: data.url },
    sound: 'default',
  }));

const isUnregistered = (result: ExpoPushTicket | ExpoPushReceipt) =>
  'error' === result.status && 'DeviceNotRegistered' === result.details?.error;

/** Tokens Expo no longer knows, and the receipts to check later for the ones it accepted. */
export const readPushTickets = (tokens: string[], tickets: ExpoPushTicket[]) => ({
  unregistered: tickets.flatMap((ticket, index) => {
    if ('error' !== ticket.status || !isUnregistered(ticket)) {
      return [];
    }

    const token = ticket.details?.expoPushToken ?? tokens[index];
    return token ? [token] : [];
  }),
  receipts: tickets.flatMap((ticket, index) => {
    const token = tokens[index];
    return 'ok' === ticket.status && token ? [{ id: ticket.id, token }] : [];
  }),
});

/** Tokens whose delivery receipt says the app is gone from the device. */
export const readPushReceipts = (
  pending: PendingPushReceipt[],
  receipts: Record<string, ExpoPushReceipt>,
) =>
  pending.flatMap(({ id, token }) => {
    const receipt = receipts[id];
    return receipt && isUnregistered(receipt) ? [token] : [];
  });
