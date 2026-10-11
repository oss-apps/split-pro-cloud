import { SplitType, type Prisma, type User } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { db } from '~/server/db';
import { type SplitwiseGroup, type SplitwiseUser } from '~/types';
import { toFixedNumber, toInteger } from '~/utils/numbers';
import { InvalidExpenseError, assertGroupSettlement, toBalancedParticipants } from '~/utils/splits';
import { captureSettlementAllocations, restoreSettlementAllocations } from './balanceProjection';
import { runBalanceTransaction } from './balanceTransaction';
import { sendExpensePushNotification } from './notificationService';
import {
  type RecurrenceInput,
  createRecurringRule,
  setExpenseRecurrence,
  stopRuleOfDeletedSource,
} from './recurringService';

type StoredParticipant = { userId: number; amount: number };

export type ExpenseInput = {
  paidBy: number;
  name: string;
  category: string;
  amount: number;
  splitType: SplitType;
  currency: string;
  participants: { userId: number; amount: number }[];
  currentUserId: number;
  expenseDate: Date;
  fileKey?: string;
};

const SETTLEMENT_ALLOCATION_VERSION = 1;

const toStoredParticipants = (participants: { userId: number; amount: number }[]) =>
  participants.map((participant) => ({
    userId: participant.userId,
    amount: toInteger(participant.amount),
  }));

const getBalancedParticipants = (groupId: number | null, input: ExpenseInput) => {
  try {
    // Personal settlements keep accepting any sign and are normalized below. Group settlements are
    // new, so they must already have the canonical shape.
    if (null !== groupId && SplitType.SETTLEMENT === input.splitType) {
      assertGroupSettlement(input.amount, input.paidBy, input.participants);
    }

    return toStoredParticipants(
      toBalancedParticipants(input.amount, input.paidBy, input.participants, input.splitType),
    );
  } catch (error) {
    if (error instanceof InvalidExpenseError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    }
    throw error;
  }
};

/**
 * Applies (direction 1) or reverts (direction -1) an expense on the precomputed balances.
 * Each pair is written as a mirrored row on both sides so `Balance` and `GroupBalance` stay
 * antisymmetric.
 */
const updateBalances = async (
  tx: Prisma.TransactionClient,
  {
    groupId,
    paidBy,
    currency,
    participants,
  }: {
    groupId: number | null;
    paidBy: number;
    currency: string;
    participants: StoredParticipant[];
  },
  direction: 1 | -1,
) => {
  const rows = participants
    .filter((participant) => participant.userId !== paidBy)
    .flatMap((participant) => [
      { userId: paidBy, friendId: participant.userId, amount: -participant.amount * direction },
      { userId: participant.userId, friendId: paidBy, amount: participant.amount * direction },
    ])
    // A stable write order keeps concurrent transactions from deadlocking on each other.
    .sort((a, b) => a.userId - b.userId || a.friendId - b.friendId);

  await Promise.all(
    rows.map((row) =>
      tx.balance.upsert({
        where: {
          userId_currency_friendId: { userId: row.userId, currency, friendId: row.friendId },
        },
        create: { userId: row.userId, currency, friendId: row.friendId, amount: row.amount },
        update: { amount: { increment: row.amount } },
      }),
    ),
  );

  if (null === groupId) {
    return;
  }

  await Promise.all(
    rows.map((row) =>
      tx.groupBalance.upsert({
        where: {
          groupId_currency_firendId_userId: {
            groupId,
            currency,
            userId: row.userId,
            firendId: row.friendId,
          },
        },
        create: {
          groupId,
          currency,
          userId: row.userId,
          firendId: row.friendId,
          amount: row.amount,
        },
        update: { amount: { increment: row.amount } },
      }),
    ),
  );
};

const hasSameFinancialEffect = (
  expense: {
    amount: number;
    currency: string;
    paidBy: number;
    splitType: SplitType;
    expenseParticipants: StoredParticipant[];
  },
  input: ExpenseInput,
) => {
  const participants = toStoredParticipants(input.participants);

  if (
    expense.amount !== toInteger(input.amount) ||
    expense.currency !== input.currency ||
    expense.paidBy !== input.paidBy ||
    expense.splitType !== input.splitType ||
    expense.expenseParticipants.length !== participants.length
  ) {
    return false;
  }

  const oldAmounts = new Map(
    expense.expenseParticipants.map((participant) => [participant.userId, participant.amount]),
  );
  return participants.every(
    (participant) => oldAmounts.get(participant.userId) === participant.amount,
  );
};

export async function joinGroup(userId: number, publicGroupId: string) {
  const group = await db.group.findUnique({
    where: {
      publicId: publicGroupId,
    },
  });

  if (!group) {
    throw new Error('Group not found');
  }

  await db.groupUser.create({
    data: {
      groupId: group.id,
      userId,
    },
  });

  return group;
}

/**
 * Adds an expense and applies it to the balances, inside a balance transaction. Recurring
 * occurrences are added through here too, so they change balances exactly like a manual add.
 * Send the notification once the transaction has committed.
 */
export const insertExpense = async (
  tx: Prisma.TransactionClient,
  groupId: number | null,
  input: ExpenseInput,
  occurrence?: { recurringId: number; occurrenceDate: Date },
) => {
  const participants = getBalancedParticipants(groupId, input);
  // Only personal settlements clear group balances, so only they track allocations.
  const tracksAllocations = SplitType.SETTLEMENT === input.splitType && null === groupId;

  const expense = await tx.expense.create({
    data: {
      groupId,
      paidBy: input.paidBy,
      name: input.name,
      category: input.category,
      amount: toInteger(input.amount),
      splitType: input.splitType,
      currency: input.currency,
      expenseParticipants: { create: participants },
      fileKey: input.fileKey,
      addedBy: input.currentUserId,
      expenseDate: input.expenseDate,
      settlementAllocationVersion: tracksAllocations ? SETTLEMENT_ALLOCATION_VERSION : null,
      recurringId: occurrence?.recurringId,
      occurrenceDate: occurrence?.occurrenceDate,
    },
  });

  await updateBalances(
    tx,
    { groupId, paidBy: input.paidBy, currency: input.currency, participants },
    1,
  );

  // A personal settlement that clears a pair also clears their group balances, and records
  // what it cleared so editing or deleting the settlement can put it back.
  if (tracksAllocations) {
    await captureSettlementAllocations(
      tx,
      expense.id,
      input.paidBy,
      participants.map((participant) => participant.userId),
      input.currency,
    );
  }

  return expense;
};

const createExpense = async (
  groupId: number | null,
  input: ExpenseInput,
  recurrence?: RecurrenceInput,
) => {
  const expense = await runBalanceTransaction(async (tx) =>
    insertExpense(
      tx,
      groupId,
      input,
      recurrence
        ? await createRecurringRule(
            tx,
            { groupId, expenseDate: input.expenseDate, splitType: input.splitType },
            recurrence,
            input.currentUserId,
          )
        : undefined,
    ),
  );

  sendExpensePushNotification(expense.id).catch(console.error);
  return expense;
};

export async function createGroupExpense(
  groupId: number,
  paidBy: number,
  name: string,
  category: string,
  amount: number,
  splitType: SplitType,
  currency: string,
  participants: { userId: number; amount: number }[],
  currentUserId: number,
  expenseDate: Date,
  fileKey?: string,
  recurrence?: RecurrenceInput,
) {
  return createExpense(
    groupId,
    {
      paidBy,
      name,
      category,
      amount,
      splitType,
      currency,
      participants,
      currentUserId,
      expenseDate,
      fileKey,
    },
    recurrence,
  );
}

export async function addUserExpense(
  paidBy: number,
  name: string,
  category: string,
  amount: number,
  splitType: SplitType,
  currency: string,
  participants: { userId: number; amount: number }[],
  currentUserId: number,
  expenseDate: Date,
  fileKey?: string,
  recurrence?: RecurrenceInput,
) {
  return createExpense(
    null,
    {
      paidBy,
      name,
      category,
      amount,
      splitType,
      currency,
      participants,
      currentUserId,
      expenseDate,
      fileKey,
    },
    recurrence,
  );
}

export async function deleteExpense(expenseId: string, deletedBy: number) {
  const deleted = await runBalanceTransaction(async (tx) => {
    const expense = await tx.expense.findUnique({
      where: { id: expenseId },
      include: { expenseParticipants: true },
    });

    if (!expense) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' });
    }

    // Deleting twice must never revert the balances twice.
    if (expense.deletedAt) {
      return false;
    }

    const { count } = await tx.expense.updateMany({
      where: { id: expenseId, deletedAt: null },
      data: { deletedBy, deletedAt: new Date() },
    });

    if (0 === count) {
      return false;
    }

    await stopRuleOfDeletedSource(tx, expense);
    await restoreSettlementAllocations(tx, expenseId);
    await updateBalances(
      tx,
      {
        groupId: expense.groupId,
        paidBy: expense.paidBy,
        currency: expense.currency,
        participants: expense.expenseParticipants,
      },
      -1,
    );

    return true;
  });

  if (deleted) {
    sendExpensePushNotification(expenseId).catch(console.error);
  }
}

/** Saves an edit and moves the balances from the old version to the new one. */
const updateExpense = async (
  tx: Prisma.TransactionClient,
  expenseId: string,
  input: ExpenseInput,
) => {
  const {
    paidBy,
    name,
    category,
    amount,
    splitType,
    currency,
    currentUserId,
    expenseDate,
    fileKey,
  } = input;

  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    include: { expenseParticipants: true },
  });

  if (!expense) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' });
  }
  if (expense.deletedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Deleted expenses cannot be edited' });
  }

  // Renaming or changing the date, category or receipt never touches balances, so it must work
  // for old expenses that would not pass today's validations.
  if (hasSameFinancialEffect(expense, input)) {
    await tx.expense.update({
      where: { id: expenseId },
      data: { name, category, fileKey, expenseDate, updatedBy: currentUserId },
    });
    return { id: expenseId };
  }

  const newParticipants = getBalancedParticipants(expense.groupId, input);
  const isSettlement = SplitType.SETTLEMENT === splitType;
  // Settlements created before allocations existed keep their original semantics: they only
  // ever change `Balance`, never `GroupBalance`. Group settlements never track allocations.
  const settlementAllocationVersion =
    !isSettlement || null !== expense.groupId
      ? null
      : SplitType.SETTLEMENT === expense.splitType
        ? expense.settlementAllocationVersion
        : SETTLEMENT_ALLOCATION_VERSION;

  await restoreSettlementAllocations(tx, expenseId);
  await updateBalances(
    tx,
    {
      groupId: expense.groupId,
      paidBy: expense.paidBy,
      currency: expense.currency,
      participants: expense.expenseParticipants,
    },
    -1,
  );
  await tx.expenseParticipant.deleteMany({ where: { expenseId } });
  await tx.expense.update({
    where: { id: expenseId },
    data: {
      paidBy,
      name,
      category,
      amount: toInteger(amount),
      splitType,
      currency,
      expenseParticipants: { create: newParticipants },
      fileKey,
      expenseDate,
      updatedBy: currentUserId,
      settlementAllocationVersion,
    },
  });
  await updateBalances(
    tx,
    { groupId: expense.groupId, paidBy, currency, participants: newParticipants },
    1,
  );

  if (null === expense.groupId && SETTLEMENT_ALLOCATION_VERSION === settlementAllocationVersion) {
    await captureSettlementAllocations(
      tx,
      expenseId,
      paidBy,
      newParticipants.map((participant) => participant.userId),
      currency,
    );
  }

  return { id: expenseId };
};

export async function editExpense(
  expenseId: string,
  paidBy: number,
  name: string,
  category: string,
  amount: number,
  splitType: SplitType,
  currency: string,
  participants: { userId: number; amount: number }[],
  currentUserId: number,
  expenseDate: Date,
  fileKey?: string,
  recurrence?: RecurrenceInput | null,
) {
  const input: ExpenseInput = {
    paidBy,
    name,
    category,
    amount,
    splitType,
    currency,
    participants,
    currentUserId,
    expenseDate,
    fileKey,
  };

  const result = await runBalanceTransaction(async (tx) => {
    const edited = await updateExpense(tx, expenseId, input);
    if (undefined !== recurrence) {
      await setExpenseRecurrence(tx, expenseId, recurrence, currentUserId);
    }
    return edited;
  });

  sendExpensePushNotification(expenseId).catch(console.error);
  return result;
}

export async function getCompleteFriendsDetails(userId: number) {
  const balances = await db.balance.findMany({
    where: {
      userId,
    },
    include: {
      friend: true,
    },
  });

  const friends = balances.reduce(
    (acc, balance) => {
      const friendId = balance.friendId;
      if (!acc[friendId]) {
        acc[friendId] = {
          balances: [],
          id: balance.friendId,
          email: balance.friend.email,
          name: balance.friend.name,
        };
      }

      if (balance.amount !== 0) {
        acc[friendId]?.balances.push({
          currency: balance.currency,
          amount:
            balance.amount > 0 ? toFixedNumber(balance.amount) : toFixedNumber(balance.amount),
        });
      }

      return acc;
    },
    {} as Record<
      number,
      {
        id: number;
        email?: string | null;
        name?: string | null;
        balances: { currency: string; amount: number }[];
      }
    >,
  );

  return friends;
}

export async function getCompleteGroupDetails(userId: number) {
  const groups = await db.group.findMany({
    where: {
      groupUsers: {
        some: {
          userId,
        },
      },
    },
    include: {
      groupUsers: true,
      groupBalances: true,
    },
  });

  return groups;
}

export async function importUserBalanceFromSplitWise(
  currentUserId: number,
  splitWiseUsers: SplitwiseUser[],
) {
  const operations = [];

  const users = await createUsersFromSplitwise(splitWiseUsers);

  const userMap = users.reduce(
    (acc, user) => {
      if (user.email) {
        acc[user.email] = user;
      }

      return acc;
    },
    {} as Record<string, User>,
  );

  for (const user of splitWiseUsers) {
    const dbUser = userMap[user.email];
    if (!dbUser) {
      continue;
    }

    for (const balance of user.balance) {
      const amount = toInteger(parseFloat(balance.amount));
      const currency = balance.currency_code;
      const existingBalance = await db.balance.findUnique({
        where: {
          userId_currency_friendId: {
            userId: currentUserId,
            currency,
            friendId: dbUser.id,
          },
        },
      });

      if (existingBalance?.importedFromSplitwise) {
        continue;
      }

      operations.push(
        db.balance.upsert({
          where: {
            userId_currency_friendId: {
              userId: currentUserId,
              currency,
              friendId: dbUser.id,
            },
          },
          update: {
            amount: {
              increment: amount,
            },
            importedFromSplitwise: true,
          },
          create: {
            userId: currentUserId,
            currency,
            friendId: dbUser.id,
            amount,
            importedFromSplitwise: true,
          },
        }),
      );

      operations.push(
        db.balance.upsert({
          where: {
            userId_currency_friendId: {
              userId: dbUser.id,
              currency,
              friendId: currentUserId,
            },
          },
          update: {
            amount: {
              increment: -amount,
            },
            importedFromSplitwise: true,
          },
          create: {
            userId: dbUser.id,
            currency,
            friendId: currentUserId,
            amount: -amount,
            importedFromSplitwise: true,
          },
        }),
      );
    }
  }

  await db.$transaction(operations);
}

async function createUsersFromSplitwise(users: Array<SplitwiseUser>) {
  const userEmails = users.map((u) => u.email);

  const existingUsers = await db.user.findMany({
    where: {
      email: {
        in: userEmails,
      },
    },
  });

  const existingUserMap: Record<string, boolean> = {};

  for (const user of existingUsers) {
    if (user.email) {
      existingUserMap[user.email] = true;
    }
  }

  const newUsers = users.filter((u) => !existingUserMap[u.email]);

  await db.user.createMany({
    data: newUsers.map((u) => ({
      email: u.email,
      name: `${u.first_name}${u.last_name ? ' ' + u.last_name : ''}`,
    })),
  });

  return db.user.findMany({
    where: {
      email: {
        in: userEmails,
      },
    },
  });
}

export async function importGroupFromSplitwise(
  currentUserId: number,
  splitWiseGroups: Array<SplitwiseGroup>,
) {
  const splitwiseUserMap: Record<string, SplitwiseUser> = {};

  for (const group of splitWiseGroups) {
    for (const member of group.members) {
      splitwiseUserMap[member.id.toString()] = member;
    }
  }

  const users = await createUsersFromSplitwise(Object.values(splitwiseUserMap));

  const userMap = users.reduce(
    (acc, user) => {
      if (user.email) {
        acc[user.email] = user;
      }

      return acc;
    },
    {} as Record<string, User>,
  );

  console.log('userMap', userMap, splitWiseGroups);

  const operations = [];
  console.log('Hello world');

  for (const group of splitWiseGroups) {
    console.log('group', group);
    const dbGroup = await db.group.findUnique({
      where: {
        splitwiseGroupId: group.id.toString(),
      },
    });

    if (dbGroup) {
      continue;
    }

    const groupmembers = group.members.map((member) => ({
      userId: userMap[member.email.toString()]!.id,
    }));

    console.log('groupmembers', groupmembers);

    operations.push(
      db.group.create({
        data: {
          name: group.name,
          splitwiseGroupId: group.id.toString(),
          publicId: nanoid(),
          userId: currentUserId,
          groupUsers: {
            create: groupmembers,
          },
        },
      }),
    );
  }

  await db.$transaction(operations);
}
