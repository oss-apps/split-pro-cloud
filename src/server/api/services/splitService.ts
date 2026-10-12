import { SplitType, SplitwiseImportMode, type Prisma, type User } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { db } from '~/server/db';
import { type SplitwiseGroup, type SplitwiseUser } from '~/types';
import { toFixedNumber, toInteger } from '~/utils/numbers';
import { InvalidExpenseError, assertGroupSettlement, toBalancedParticipants } from '~/utils/splits';
import { captureSettlementAllocations, restoreSettlementAllocations } from './balanceProjection';
import { runBalanceTransaction } from './balanceTransaction';
import { claimSplitwisePairs } from './splitwiseImportLocks';
import {
  sendExpensePushNotification,
  sendRecurringStatusPushNotification,
} from './notificationService';
import {
  type RecurrenceInput,
  assertCanChangeRecurrence,
  createRecurringRule,
  lockRuleOfExpense,
  onOccurrenceDeleted,
  setExpenseRecurrence,
  setRuleTemplate,
  syncRuleTemplate,
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

type BalanceRow = { userId: number; friendId: number; amount: number };

/** The mirrored balance changes of one expense, applied (direction 1) or reverted (-1). */
const toBalanceRows = (
  paidBy: number,
  participants: StoredParticipant[],
  direction: 1 | -1,
): BalanceRow[] =>
  participants
    .filter((participant) => participant.userId !== paidBy)
    .flatMap((participant) => [
      { userId: paidBy, friendId: participant.userId, amount: -participant.amount * direction },
      { userId: participant.userId, friendId: paidBy, amount: participant.amount * direction },
    ]);

/**
 * Adds balance changes to `Balance`, and to `GroupBalance` for a group. Each pair is written as a
 * mirrored row on both sides so the tables stay antisymmetric.
 */
const writeBalanceRows = async (
  tx: Prisma.TransactionClient,
  groupId: number | null,
  currency: string,
  balanceRows: BalanceRow[],
) => {
  // A stable write order keeps concurrent transactions from deadlocking on each other.
  const rows = [...balanceRows].sort((a, b) => a.userId - b.userId || a.friendId - b.friendId);

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

/** Applies (direction 1) or reverts (direction -1) an expense on the precomputed balances. */
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
) => writeBalanceRows(tx, groupId, currency, toBalanceRows(paidBy, participants, direction));

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

export type ImportedExpenseInput = ExpenseInput & {
  splitwiseExpenseId: string;
  splitwiseScope: string;
  splitwisePart: number;
};

/** An expense being imported already exists with different money, people or group. */
export class ImportedExpenseMismatchError extends Error {}

type SavedImportedExpense = {
  groupId: number | null;
  amount: number;
  currency: string;
  paidBy: number;
  splitType: SplitType;
  splitwisePart: number | null;
  deletedAt: Date | null;
  expenseParticipants: { userId: number; amount: number }[];
};

/**
 * Whether saved parts of a Splitwise expense move exactly the same money as the parts being
 * imported: the same group (or none), amount, currency, payer, settle up or not, and every
 * non-zero share. People with a zero share don't change a balance, and the importer is added to
 * parts with zero, so they are left out.
 */
export const isSameImportedExpense = (
  saved: SavedImportedExpense[],
  groupId: number | null,
  parts: {
    amount: number;
    currency: string;
    paidBy: number;
    isSettlement: boolean;
    splitwisePart: number;
    shares: { userId: number; amount: number }[];
  }[],
) =>
  saved.length === parts.length &&
  parts.every((part) => {
    const row = saved.find((s) => s.splitwisePart === part.splitwisePart);
    if (
      !row ||
      null !== row.deletedAt ||
      row.groupId !== groupId ||
      row.amount !== part.amount ||
      row.currency !== part.currency ||
      row.paidBy !== part.paidBy ||
      (SplitType.SETTLEMENT === row.splitType) !== part.isSettlement
    ) {
      return false;
    }
    const nonZero = (shares: { userId: number; amount: number }[]) =>
      shares
        .filter((share) => 0 !== share.amount)
        .map((share) => `${share.userId}:${share.amount}`)
        .sort()
        .join(',');
    return nonZero(row.expenseParticipants) === nonZero(part.shares);
  });

/**
 * The people whose balances an imported expense changes: the payer and everyone with a non-zero
 * share. The same Splitwise expense id with any of the same people is the same expense.
 */
export const getFinancialParties = (paidBy: number, shares: { userId: number; amount: number }[]) =>
  new Set([paidBy, ...shares.filter((share) => 0 !== share.amount).map((share) => share.userId)]);

/** Checks an expense to import exactly like a manual add would, without saving anything. */
export const assertValidImportedExpense = (groupId: number | null, input: ExpenseInput) => {
  getBalancedParticipants(groupId, input);
};

/**
 * Adds expenses imported from Splitwise, inside a balance transaction. Each is validated like a
 * manual add and changes the balances the same way; the changes are summed per pair so a batch
 * writes each balance row once. No notifications are sent.
 *
 * A personal settlement keeps Splitwise's meaning: it only changes the balance outside groups.
 * Unlike a settle up added in SplitPro, it doesn't clear group balances (no allocations).
 *
 * The same Splitwise expense saved meanwhile in another scope (another group, or outside groups)
 * with any of the same people is never saved again: this throws `ImportedExpenseMismatchError`.
 * Expenses already saved in the same scope (someone imported them in the meantime) are skipped by
 * the unique index, then read to check they move the same money; if not, this throws too. Either
 * way nothing in the batch is saved. Returns the expenses it added and the Splitwise ids it skipped.
 */
export const insertImportedExpenses = async (
  tx: Prisma.TransactionClient,
  groupId: number | null,
  inputs: ImportedExpenseInput[],
) => {
  if (!inputs.length) {
    return { added: [], skippedIds: [] };
  }

  const prepared = inputs.map((input) => ({
    input,
    participants: getBalancedParticipants(groupId, input),
  }));

  // Read through the Splitwise id index only, so this conflicts with nothing but other imports of
  // the same ids.
  const elsewhere = await tx.expense.findMany({
    where: { splitwiseExpenseId: { in: [...new Set(inputs.map((i) => i.splitwiseExpenseId))] } },
    select: {
      splitwiseExpenseId: true,
      splitwiseScope: true,
      paidBy: true,
      expenseParticipants: { select: { userId: true, amount: true } },
    },
  });
  elsewhere.forEach((row) => {
    const entries = prepared.filter(
      ({ input }) =>
        input.splitwiseExpenseId === row.splitwiseExpenseId &&
        input.splitwiseScope !== row.splitwiseScope,
    );
    const rowParties = getFinancialParties(row.paidBy, row.expenseParticipants);
    const overlaps = entries.some(({ input, participants }) =>
      [...getFinancialParties(input.paidBy, participants)].some((id) => rowParties.has(id)),
    );
    if (overlaps) {
      throw new ImportedExpenseMismatchError(
        `"${entries[0]!.input.name}" was imported somewhere else at the same time, with some of the same people.`,
      );
    }
  });

  const expenses = await tx.expense.createManyAndReturn({
    data: prepared.map(({ input }) => ({
      groupId,
      paidBy: input.paidBy,
      name: input.name,
      category: input.category,
      amount: toInteger(input.amount),
      splitType: input.splitType,
      currency: input.currency,
      addedBy: input.currentUserId,
      expenseDate: input.expenseDate,
      splitwiseExpenseId: input.splitwiseExpenseId,
      splitwiseScope: input.splitwiseScope,
      splitwisePart: input.splitwisePart,
    })),
    select: { id: true, splitwiseExpenseId: true, splitwisePart: true },
    skipDuplicates: true,
  });
  const keyOf = (expense: { splitwiseExpenseId: string | null; splitwisePart: number | null }) =>
    `${expense.splitwiseExpenseId}:${expense.splitwisePart}`;
  const expenseIds = new Map(expenses.map((expense) => [keyOf(expense), expense.id]));
  const added = prepared.filter(({ input }) => expenseIds.has(keyOf(input)));
  const addedIds = new Set(added.map(({ input }) => input.splitwiseExpenseId));
  const skipped = prepared.filter(({ input }) => !addedIds.has(input.splitwiseExpenseId));

  // Parts of one Splitwise expense are always saved together, so they are skipped together too.
  // What was skipped must be the same money; otherwise two different versions were imported.
  if (added.length + skipped.length !== prepared.length) {
    throw new ImportedExpenseMismatchError(
      'A Splitwise expense was imported at the same time with different parts.',
    );
  }
  if (skipped.length) {
    const saved = await tx.expense.findMany({
      where: {
        splitwiseExpenseId: {
          in: [...new Set(skipped.map(({ input }) => input.splitwiseExpenseId))],
        },
        splitwiseScope: { in: [...new Set(skipped.map(({ input }) => input.splitwiseScope))] },
      },
      select: {
        splitwiseExpenseId: true,
        splitwiseScope: true,
        splitwisePart: true,
        groupId: true,
        amount: true,
        currency: true,
        paidBy: true,
        splitType: true,
        deletedAt: true,
        expenseParticipants: { select: { userId: true, amount: true } },
      },
    });
    const byExpense = new Map<string, typeof skipped>();
    skipped.forEach((entry) => {
      const key = `${entry.input.splitwiseScope}|${entry.input.splitwiseExpenseId}`;
      byExpense.set(key, [...(byExpense.get(key) ?? []), entry]);
    });
    byExpense.forEach((entries, key) => {
      const rows = saved.filter((row) => `${row.splitwiseScope}|${row.splitwiseExpenseId}` === key);
      const parts = entries.map(({ input, participants }) => ({
        amount: toInteger(input.amount),
        currency: input.currency,
        paidBy: input.paidBy,
        isSettlement: SplitType.SETTLEMENT === input.splitType,
        splitwisePart: input.splitwisePart,
        shares: participants,
      }));
      if (!isSameImportedExpense(rows, groupId, parts)) {
        throw new ImportedExpenseMismatchError(
          `"${entries[0]!.input.name}" was imported at the same time with different amounts or people.`,
        );
      }
    });
  }

  await tx.expenseParticipant.createMany({
    data: added.flatMap(({ input, participants }) =>
      participants.map((participant) => ({
        expenseId: expenseIds.get(`${input.splitwiseExpenseId}:${input.splitwisePart}`)!,
        userId: participant.userId,
        amount: participant.amount,
      })),
    ),
  });

  const rowsByCurrency = new Map<string, Map<string, BalanceRow>>();
  added.forEach(({ input, participants }) => {
    const rows = rowsByCurrency.get(input.currency) ?? new Map<string, BalanceRow>();
    rowsByCurrency.set(input.currency, rows);
    toBalanceRows(input.paidBy, participants, 1).forEach((row) => {
      const key = `${row.userId}:${row.friendId}`;
      rows.set(key, { ...row, amount: (rows.get(key)?.amount ?? 0) + row.amount });
    });
  });

  for (const [currency, rows] of rowsByCurrency) {
    await writeBalanceRows(tx, groupId, currency, [...rows.values()]);
  }

  return {
    added: expenses,
    skippedIds: [...new Set(skipped.map(({ input }) => input.splitwiseExpenseId))],
  };
};

const createExpense = async (
  groupId: number | null,
  input: ExpenseInput,
  recurrence?: RecurrenceInput,
) => {
  const expense = await runBalanceTransaction(async (tx) => {
    const occurrence = recurrence
      ? await createRecurringRule(
          tx,
          { groupId, expenseDate: input.expenseDate, splitType: input.splitType },
          recurrence,
          input.currentUserId,
        )
      : undefined;
    const expense = await insertExpense(tx, groupId, input, occurrence);
    if (occurrence) {
      await setRuleTemplate(tx, occurrence.recurringId, expense.id);
    }
    return expense;
  });

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
    await lockRuleOfExpense(tx, expenseId);
    const expense = await tx.expense.findUnique({
      where: { id: expenseId },
      include: { expenseParticipants: true },
    });

    if (!expense) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Expense not found' });
    }

    // Deleting twice must never revert the balances twice.
    if (expense.deletedAt) {
      return { deleted: false };
    }

    const { count } = await tx.expense.updateMany({
      where: { id: expenseId, deletedAt: null },
      data: { deletedBy, deletedAt: new Date() },
    });

    if (0 === count) {
      return { deleted: false };
    }

    const changedRuleId = await onOccurrenceDeleted(tx, expense);
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

    return { deleted: true, changedRuleId };
  });

  if (deleted.deleted) {
    sendExpensePushNotification(expenseId).catch(console.error);
  }
  if (deleted.changedRuleId) {
    sendRecurringStatusPushNotification(deleted.changedRuleId).catch(console.error);
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

  const { edited, changedRuleIds } = await runBalanceTransaction(async (tx) => {
    const recurringId = await lockRuleOfExpense(tx, expenseId);
    // Checked against the rule and expense as they were before this edit.
    const changesRecurrence =
      undefined !== recurrence &&
      (await assertCanChangeRecurrence(tx, expenseId, recurrence, currentUserId));
    const edited = await updateExpense(tx, expenseId, input);
    const changedRuleIds = await syncRuleTemplate(tx, expenseId, recurringId);
    if (changesRecurrence) {
      await setExpenseRecurrence(tx, expenseId, recurrence, currentUserId);
    }
    return { edited, changedRuleIds };
  });

  sendExpensePushNotification(expenseId).catch(console.error);
  changedRuleIds.forEach((ruleId) => {
    sendRecurringStatusPushNotification(ruleId).catch(console.error);
  });
  return edited;
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

/**
 * Imports a balance-only file: each friend's Splitwise balance is added as one amount. Returns
 * the friends skipped because their history was imported with expenses, which already make up
 * their balance. The pair is claimed in the same transaction as the balance, so an import with
 * history at the same time can't add it a second time.
 */
export async function importUserBalanceFromSplitWise(
  currentUserId: number,
  splitWiseUsers: SplitwiseUser[],
) {
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

  const friends = splitWiseUsers
    .map((user) => ({ user, dbUser: userMap[user.email] }))
    .filter(
      (entry): entry is { user: SplitwiseUser; dbUser: User } =>
        !!entry.dbUser && entry.dbUser.id !== currentUserId,
    )
    .sort((a, b) => a.dbUser.id - b.dbUser.id);

  return runBalanceTransaction(async (tx) => {
    const skipped: string[] = [];
    const withBalance = friends.filter(({ user }) =>
      user.balance.some((balance) => 0 !== toInteger(parseFloat(balance.amount))),
    );
    const historyPairs = await claimSplitwisePairs(
      tx,
      withBalance.map(({ dbUser }) => [currentUserId, dbUser.id]),
      SplitwiseImportMode.BALANCE,
    );
    const withHistory = new Set(historyPairs.flat());

    for (const { user, dbUser } of withBalance) {
      // Adding the balance on top would count it twice.
      if (withHistory.has(dbUser.id)) {
        skipped.push(dbUser.name ?? dbUser.email ?? user.email);
        continue;
      }

      for (const balance of user.balance) {
        const amount = toInteger(parseFloat(balance.amount));
        const currency = balance.currency_code;
        const existingBalance = await tx.balance.findUnique({
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

        await tx.balance.upsert({
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
        });

        await tx.balance.upsert({
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
        });
      }
    }

    return skipped;
  });
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
