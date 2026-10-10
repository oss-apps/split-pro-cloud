import { TRPCError } from '@trpc/server';
import { db } from '~/server/db';

type ExpenseInput = {
  paidBy: number;
  participants: { userId: number }[];
  expenseId?: string;
};

/**
 * Records that two users know each other, in both directions.
 */
export async function addFriendship(userId: number, friendId: number) {
  if (userId === friendId) {
    return;
  }

  await db.friendship.createMany({
    data: [
      { userId, friendId },
      { userId: friendId, friendId: userId },
    ],
    skipDuplicates: true,
  });
}

export async function deleteFriendship(userId: number, friendId: number) {
  await db.friendship.deleteMany({
    where: {
      OR: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
    },
  });
}

/**
 * Returns the subset of `candidateIds` the caller is allowed to put on an expense or in a group.
 * A user is known if it is the caller, a friend (invited by email), someone the caller has a
 * balance with, or someone sharing a group with the caller.
 */
export async function getKnownUserIds(callerId: number, candidateIds: number[]) {
  const known = new Set<number>();
  const others = [...new Set(candidateIds)].filter((id) => {
    if (id === callerId) {
      known.add(id);
      return false;
    }
    return true;
  });

  if (others.length === 0) {
    return known;
  }

  const [friendships, balances, groupUsers] = await Promise.all([
    db.friendship.findMany({
      where: {
        OR: [
          { userId: callerId, friendId: { in: others } },
          { friendId: callerId, userId: { in: others } },
        ],
      },
      select: { userId: true, friendId: true },
    }),
    db.balance.findMany({
      where: {
        OR: [
          { userId: callerId, friendId: { in: others } },
          { friendId: callerId, userId: { in: others } },
        ],
      },
      select: { userId: true, friendId: true },
    }),
    db.groupUser.findMany({
      where: {
        userId: { in: others },
        group: { groupUsers: { some: { userId: callerId } } },
      },
      select: { userId: true },
    }),
  ]);

  for (const row of [...friendships, ...balances]) {
    known.add(row.userId === callerId ? row.friendId : row.userId);
  }

  for (const row of groupUsers) {
    known.add(row.userId);
  }

  return known;
}

export async function assertKnownUsers(callerId: number, userIds: number[]) {
  const known = await getKnownUserIds(callerId, userIds);

  if (userIds.some((id) => !known.has(id))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can only add people you know. Add them by email first.',
    });
  }
}

function assertUniqueParticipants(participants: { userId: number }[]) {
  const ids = participants.map((p) => p.userId);

  if (new Set(ids).size !== ids.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Duplicate participants in expense' });
  }
}

async function getEditableExpense(expenseId: string, callerId: number) {
  const expense = await db.expense.findUnique({
    where: { id: expenseId },
    include: { expenseParticipants: { select: { userId: true } } },
  });

  if (!expense?.expenseParticipants.some((p) => p.userId === callerId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not the participant of the expense',
    });
  }

  return expense;
}

function getExpenseUserIds(expense: { paidBy: number; expenseParticipants: { userId: number }[] }) {
  return new Set([expense.paidBy, ...expense.expenseParticipants.map((p) => p.userId)]);
}

/**
 * Checks for `user.addOrEditExpense` (expenses without a group).
 */
export async function assertCanSavePersonalExpense(callerId: number, input: ExpenseInput) {
  assertUniqueParticipants(input.participants);

  if (input.paidBy !== callerId && !input.participants.some((p) => p.userId === callerId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You must be the payer or a participant of the expense',
    });
  }

  let existingUserIds = new Set<number>();

  if (input.expenseId) {
    const expense = await getEditableExpense(input.expenseId, callerId);

    if (null !== expense.groupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Group expenses must be edited from the group',
      });
    }

    existingUserIds = getExpenseUserIds(expense);
  }

  const newUserIds = [input.paidBy, ...input.participants.map((p) => p.userId)].filter(
    (id) => !existingUserIds.has(id),
  );

  await assertKnownUsers(callerId, newUserIds);
}

/**
 * Checks for `group.addOrEditExpense`. The caller's group membership is checked by groupProcedure.
 */
export async function assertCanSaveGroupExpense(
  callerId: number,
  groupId: number,
  input: ExpenseInput,
) {
  assertUniqueParticipants(input.participants);

  let existingUserIds = new Set<number>();

  if (input.expenseId) {
    const expense = await getEditableExpense(input.expenseId, callerId);

    if (expense.groupId !== groupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Expense does not belong to this group',
      });
    }

    // Old expenses keep everyone who was a member at the time, including people who left since.
    existingUserIds = getExpenseUserIds(expense);
  }

  const userIds = [...new Set([input.paidBy, ...input.participants.map((p) => p.userId)])].filter(
    (id) => !existingUserIds.has(id),
  );

  if (userIds.length === 0) {
    return;
  }

  const members = await db.groupUser.findMany({
    where: { groupId, userId: { in: userIds } },
    select: { userId: true },
  });

  if (members.length !== userIds.length) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only group members can be part of a group expense',
    });
  }
}

/**
 * An expense is visible to its payer and participants, and to current members of its group.
 */
export async function canViewExpense(
  callerId: number,
  expense: { paidBy: number; groupId: number | null; expenseParticipants: { userId: number }[] },
) {
  if (getExpenseUserIds(expense).has(callerId)) {
    return true;
  }

  if (null === expense.groupId) {
    return false;
  }

  const groupUser = await db.groupUser.findUnique({
    where: { groupId_userId: { groupId: expense.groupId, userId: callerId } },
  });

  return !!groupUser;
}
