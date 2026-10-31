import { SplitType } from '@prisma/client';
import { db } from '~/server/db';
import { getDevicePushTokens, sendExpoPushNotifications } from '~/server/expoPush';
import { pushNotification } from '~/server/notification';
import { type NativePushData, getExpensePushUrl } from '~/utils/expoPush';
import { toFixedNumber } from '~/utils/numbers';

/** Every notification goes out here, to the users' web subscriptions and native app devices. */
const sendToUsers = async (userIds: number[], pushData: NativePushData) => {
  const [subscriptions, deviceTokens] = await Promise.all([
    db.pushNotification.findMany({ where: { userId: { in: userIds } } }),
    getDevicePushTokens(userIds),
  ]);
  const webPushData = { title: pushData.title, message: pushData.message };

  await Promise.all([
    ...subscriptions.map((s) => pushNotification(s.subscription, webPushData)),
    sendExpoPushNotifications(deviceTokens, pushData),
  ]);
};

export async function sendExpensePushNotification(expenseId: string) {
  const expense = await db.expense.findUnique({
    where: {
      id: expenseId,
    },
    select: {
      id: true,
      groupId: true,
      paidBy: true,
      amount: true,
      currency: true,
      addedBy: true,
      name: true,
      deletedBy: true,
      splitType: true,
      deletedByUser: {
        select: {
          name: true,
          email: true,
        },
      },
      expenseParticipants: {
        select: {
          userId: true,
        },
      },
      paidByUser: {
        select: {
          name: true,
          email: true,
        },
      },
      addedByUser: {
        select: {
          name: true,
          email: true,
        },
      },
      updatedByUser: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!expense) {
    return;
  }

  const participants = expense.deletedBy
    ? expense.expenseParticipants.map((p) => p.userId).filter((e) => e !== expense.deletedBy)
    : expense.expenseParticipants.map((p) => p.userId).filter((e) => e !== expense.addedBy);

  const pushData = expense.deletedBy
    ? {
        title: `${expense.deletedByUser?.name ?? expense.deletedByUser?.email}`,
        message: `Deleted ${expense.name}`,
      }
    : expense.updatedByUser
      ? {
          title: `${expense.updatedByUser.name ?? expense.updatedByUser.email}`,
          message: `Updated ${expense.name} ${expense.currency} ${toFixedNumber(expense.amount)}`,
        }
      : expense.splitType === SplitType.SETTLEMENT
        ? {
            title: `${expense.addedByUser.name ?? expense.addedByUser.email}`,
            message: `${expense.paidByUser.name ?? expense.paidByUser.email} settled up ${expense.currency} ${toFixedNumber(expense.amount)}`,
          }
        : {
            title: `${expense.addedByUser.name ?? expense.addedByUser.email}`,
            message: `${expense.paidByUser.name ?? expense.paidByUser.email} paid  ${expense.currency} ${toFixedNumber(expense.amount)} for ${expense.name}`,
          };

  await sendToUsers(participants, { ...pushData, url: getExpensePushUrl(expense) });
}

/** Tells the other members of a group that its default split was changed or removed. */
export async function sendDefaultSplitPushNotification(
  groupId: number,
  changedBy: number,
  isSet: boolean,
) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    select: {
      name: true,
      groupUsers: { select: { userId: true, user: { select: { name: true, email: true } } } },
    },
  });

  if (!group) {
    return;
  }

  const user = group.groupUsers.find((groupUser) => groupUser.userId === changedBy)?.user;
  await sendToUsers(
    group.groupUsers.map((groupUser) => groupUser.userId).filter((userId) => userId !== changedBy),
    {
      title: group.name,
      message: `${user?.name ?? user?.email ?? 'A member'} ${isSet ? 'changed' : 'removed'} the default split`,
      url: `/groups/${groupId}`,
    },
  );
}

/** Tells the creator of a recurring expense that it was paused or stopped, and why. */
export async function sendRecurringStatusPushNotification(recurringId: number) {
  const rule = await db.recurringExpense.findUnique({
    where: { id: recurringId },
    select: {
      createdById: true,
      groupId: true,
      status: true,
      statusReason: true,
      occurrences: {
        orderBy: { occurrenceDate: 'desc' },
        take: 1,
        select: { id: true, name: true },
      },
    },
  });

  // Without a creator (their account is gone) there's no one to tell.
  if (!rule || 'ACTIVE' === rule.status || null === rule.createdById) {
    return;
  }

  const latest = rule.occurrences[0];
  await sendToUsers([rule.createdById], {
    title: `${latest?.name ?? 'A recurring expense'} ${'PAUSED' === rule.status ? 'paused' : 'stopped'}`,
    message: rule.statusReason ?? '',
    url: latest
      ? `/expenses/${latest.id}`
      : null === rule.groupId
        ? '/activity'
        : `/groups/${rule.groupId}`,
  });
}

/** Tells creators that their recurring expenses went away with their group. */
export async function sendRecurringGroupDeletedPushNotification(
  rules: Array<{ createdById: number; name: string }>,
  groupName: string,
) {
  await Promise.all(
    rules.map((rule) =>
      sendToUsers([rule.createdById], {
        title: `${rule.name} stopped`,
        message: `The group ${groupName} was deleted`,
        url: '/groups',
      }),
    ),
  );
}
