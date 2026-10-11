import {
  type Prisma,
  type RecurringExpense,
  type RecurringFrequency,
  RecurringStatus,
  SplitType,
} from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { db } from '~/server/db';
import {
  RECURRING_FREQUENCIES,
  fromDbDate,
  getDueAt,
  getLocalDate,
  getNextOccurrence,
  isValidTimeZone,
  recurrenceInputSchema,
  toDbDate,
} from '~/utils/recurrence';
import { getKnownUserIds } from './accessControl';

export { recurrenceInputSchema };

export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

export const ACCOUNT_GONE_REASON = "Someone in this expense doesn't have an account anymore";
export const CREATOR_GONE_REASON = "The person who set it up doesn't have an account anymore";
export const SOURCE_DELETED_REASON = 'The first expense was deleted';
export const LATEST_DELETED_REASON = 'The latest expense was deleted';
export const NOT_IN_EXPENSE_MESSAGE = 'Only people in this expense can change how it repeats';

type RuleProblem = { status: RecurringStatus; reason: string };

type RuleToCheck = Pick<
  RecurringExpense,
  'id' | 'groupId' | 'createdById' | 'startDate' | 'templateExpenseId' | 'templateUserIds'
>;

const nameOf = (user: { name: string | null; email: string | null } | null | undefined) =>
  user?.name ?? user?.email ?? 'Someone';

const joinNames = (names: string[]) =>
  1 < names.length ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

const getTemplateUserIds = (expense: {
  paidBy: number;
  expenseParticipants: Array<{ userId: number }>;
}) => [...new Set([expense.paidBy, ...expense.expenseParticipants.map((p) => p.userId)])];

const isSameIds = (a: number[], b: number[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Records the expense the rule's next occurrence copies, with everyone in it. Called in the
 * transaction that adds the occurrence (or the expense it was set up on).
 */
export async function setRuleTemplate(
  tx: Prisma.TransactionClient,
  recurringId: number,
  expenseId: string,
) {
  const expense = await tx.expense.findUniqueOrThrow({
    where: { id: expenseId },
    select: { paidBy: true, expenseParticipants: { select: { userId: true } } },
  });
  await tx.recurringExpense.update({
    where: { id: recurringId },
    data: { templateExpenseId: expenseId, templateUserIds: getTemplateUserIds(expense) },
  });
}

/** Editing the occurrence a rule copies changes who is in its next ones, in the same transaction. */
export async function syncRuleTemplate(tx: Prisma.TransactionClient, expenseId: string) {
  const rules = await tx.recurringExpense.findMany({
    where: { templateExpenseId: expenseId },
    select: { id: true },
  });
  for (const rule of rules) {
    await setRuleTemplate(tx, rule.id, expenseId);
  }
}

/** The latest date the rule has an occurrence for, deleted ones included. */
const getLatestOccurrenceDate = async (tx: Prisma.TransactionClient, rule: RecurringExpense) => {
  const latest = await tx.expense.findFirst({
    where: { recurringId: rule.id },
    orderBy: { occurrenceDate: 'desc' },
    select: { occurrenceDate: true },
  });
  return fromDbDate(latest?.occurrenceDate ?? rule.startDate);
};

const getRuleTemplate = (tx: Prisma.TransactionClient, templateExpenseId: string) =>
  tx.expense.findUnique({
    where: { id: templateExpenseId },
    include: {
      expenseParticipants: { include: { user: { select: { name: true, email: true } } } },
    },
  });

type Template = NonNullable<Awaited<ReturnType<typeof getRuleTemplate>>>;

/**
 * Whether the rule can add its next occurrence, and the occurrence it copies: exactly the one it
 * recorded, never an older one. Rules that can't are paused (or stopped, once their first expense
 * is deleted or their creator's account is gone) instead of adding a wrong expense.
 */
export async function checkRule(
  tx: Prisma.TransactionClient,
  rule: RuleToCheck,
): Promise<
  { template: Template; createdById: number; problem?: undefined } | { problem: RuleProblem }
> {
  const paused = (reason: string) => ({ problem: { status: RecurringStatus.PAUSED, reason } });
  const stopped = (reason: string) => ({ problem: { status: RecurringStatus.STOPPED, reason } });

  if (null === rule.createdById) {
    return stopped(CREATOR_GONE_REASON);
  }

  const source = await tx.expense.findUnique({
    where: { recurringId_occurrenceDate: { recurringId: rule.id, occurrenceDate: rule.startDate } },
    select: { deletedAt: true },
  });
  if (source?.deletedAt) {
    return stopped(SOURCE_DELETED_REASON);
  }

  // Expenses are only ever removed for good with the account of the person who paid them.
  const template = rule.templateExpenseId
    ? await getRuleTemplate(tx, rule.templateExpenseId)
    : null;
  if (!template || !rule.templateUserIds.length) {
    return paused(ACCOUNT_GONE_REASON);
  }
  if (template.deletedAt) {
    return paused(LATEST_DELETED_REASON);
  }

  // Everyone recorded must still have an account and their row in the expense, also with a zero
  // share. Each saved expense adds up to zero and has the payer's own row.
  const userIds = rule.templateUserIds;
  const existing = await tx.user.count({ where: { id: { in: userIds } } });
  const total = template.expenseParticipants.reduce((sum, p) => sum + p.amount, 0);
  if (
    existing !== userIds.length ||
    !isSameIds(getTemplateUserIds(template), userIds) ||
    0 !== total ||
    !template.expenseParticipants.some((p) => p.userId === template.paidBy)
  ) {
    return paused(ACCOUNT_GONE_REASON);
  }

  if (SplitType.SETTLEMENT === template.splitType) {
    return paused("Payments can't repeat");
  }

  const creatorId = rule.createdById;
  const names = new Map(template.expenseParticipants.map((p) => [p.userId, nameOf(p.user)]));
  const creator = await tx.user.findUnique({
    where: { id: creatorId },
    select: { name: true, email: true },
  });
  if (!creator) {
    return stopped(CREATOR_GONE_REASON);
  }
  names.set(creatorId, nameOf(creator));

  if (null !== rule.groupId) {
    const members = await tx.groupUser.findMany({
      where: { groupId: rule.groupId, userId: { in: [...userIds, creatorId] } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const gone = [...new Set([...userIds, creatorId])].filter((id) => !memberIds.has(id));
    if (gone.length) {
      return paused(`${joinNames(gone.map((id) => names.get(id) ?? 'Someone'))} left the group`);
    }
    return { template, createdById: creatorId };
  }

  // Without a group, it is added by its creator, who has to be part of it like for any expense.
  if (!userIds.includes(creatorId)) {
    return paused(`${names.get(creatorId)} isn't part of this expense anymore`);
  }
  const known = await getKnownUserIds(creatorId, userIds);
  const unknown = userIds.filter((id) => !known.has(id));
  if (unknown.length) {
    return paused(
      `${names.get(creatorId)} and ${joinNames(unknown.map((id) => names.get(id) ?? 'Someone'))} aren't friends anymore`,
    );
  }

  return { template, createdById: creatorId };
}

/** When the rule's next occurrence is due, after its latest one and not before today. */
const getNextPointer = async (
  tx: Prisma.TransactionClient,
  rule: RecurringExpense,
  frequency: RecurringFrequency,
  now: Date,
) => {
  const next = getNextOccurrence(
    frequency,
    fromDbDate(rule.startDate),
    await getLatestOccurrenceDate(tx, rule),
    getLocalDate(now, rule.timezone),
  );
  return { nextOccurrenceDate: toDbDate(next), nextOccurrenceAt: getDueAt(next, rule.timezone) };
};

/**
 * Starts repeating an expense being added, in the transaction that adds it: on the next date of
 * the schedule after the expense's own. The add itself checks the payer, participants and group.
 * Returns what the new expense is saved with to belong to the rule.
 */
export async function createRecurringRule(
  tx: Prisma.TransactionClient,
  expense: { groupId: number | null; expenseDate: Date; splitType: SplitType },
  recurrence: RecurrenceInput,
  createdById: number,
  now = new Date(),
) {
  if (!isValidTimeZone(recurrence.timezone)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown time zone' });
  }
  if (SplitType.SETTLEMENT === expense.splitType) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Payments can't repeat" });
  }

  const start = getLocalDate(expense.expenseDate, recurrence.timezone);
  const next = getNextOccurrence(
    recurrence.frequency,
    start,
    start,
    getLocalDate(now, recurrence.timezone),
  );
  const rule = await tx.recurringExpense.create({
    data: {
      frequency: recurrence.frequency,
      timezone: recurrence.timezone,
      startDate: toDbDate(start),
      nextOccurrenceDate: toDbDate(next),
      nextOccurrenceAt: getDueAt(next, recurrence.timezone),
      groupId: expense.groupId,
      createdById,
    },
  });
  return { recurringId: rule.id, occurrenceDate: rule.startDate };
}

/**
 * Whether an edit asks to change how the expense repeats, after checking the caller may. Call it
 * in the edit's transaction, before the edit, so it sees the rule as it was.
 *
 * A rule keeps the time zone it was set up in, so only starting, stopping or changing the frequency
 * is a change. Asking for what it already is changes nothing and never fails, so anyone who may
 * edit an old occurrence still can. A rule can be changed from any of its occurrences, but only by
 * who may manage it (see `canManageRule`), exactly as through the recurring API.
 */
export async function assertCanChangeRecurrence(
  tx: Prisma.TransactionClient,
  expenseId: string,
  recurrence: RecurrenceInput | null,
  userId: number,
) {
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    include: { recurring: true },
  });
  // A stopped rule is history only. Repeating one of its expenses starts a new rule.
  const rule =
    expense?.recurring && RecurringStatus.STOPPED !== expense.recurring.status
      ? expense.recurring
      : null;

  const isChange = rule
    ? !recurrence || recurrence.frequency !== rule.frequency
    : null !== recurrence;
  if (!isChange) {
    return false;
  }

  if (rule && !(await canManageRule(tx, userId, rule))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: NOT_IN_EXPENSE_MESSAGE });
  }
  return true;
}

/**
 * Sets how a saved expense repeats, in the transaction that saves it, once
 * `assertCanChangeRecurrence` allowed it. A new rule starts from the expense's date, copies it,
 * and adds its first occurrence on the next date of the schedule from today on. Changing the
 * frequency keeps the rule (and whether it is paused); `null` removes it, keeping the expenses it
 * added.
 */
export async function setExpenseRecurrence(
  tx: Prisma.TransactionClient,
  expenseId: string,
  recurrence: RecurrenceInput | null,
  userId: number,
  now = new Date(),
) {
  const expense = await tx.expense.findUniqueOrThrow({
    where: { id: expenseId },
    include: { recurring: true },
  });
  const rule =
    expense.recurring && RecurringStatus.STOPPED !== expense.recurring.status
      ? expense.recurring
      : null;

  if (!recurrence) {
    if (rule) {
      await tx.recurringExpense.delete({ where: { id: rule.id } });
    }
    return;
  }

  if (rule) {
    if (rule.frequency === recurrence.frequency) {
      return;
    }

    await tx.recurringExpense.update({
      where: { id: rule.id },
      data: {
        frequency: recurrence.frequency,
        ...(await getNextPointer(tx, rule, recurrence.frequency, now)),
      },
    });
    return;
  }

  const occurrence = await createRecurringRule(tx, expense, recurrence, userId, now);
  await tx.expense.update({ where: { id: expenseId }, data: occurrence });
  await setRuleTemplate(tx, occurrence.recurringId, expenseId);

  // A saved expense may be older than today's checks, e.g. without the payer's own row.
  const check = await checkRule(
    tx,
    await tx.recurringExpense.findUniqueOrThrow({ where: { id: occurrence.recurringId } }),
  );
  if (check.problem) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: check.problem.reason });
  }
}

/**
 * Deleting an occurrence by hand: the expense a rule was set up on stops it, the one it copies
 * next pauses it (it never goes back to an older one). Others just stay deleted. Returns the rule
 * whose creator should be told, if any.
 */
export async function onOccurrenceDeleted(
  tx: Prisma.TransactionClient,
  expense: { id: string; recurringId: number | null; occurrenceDate: Date | null },
) {
  if (null === expense.recurringId || null === expense.occurrenceDate) {
    return undefined;
  }

  const stopped = await tx.recurringExpense.updateMany({
    where: {
      id: expense.recurringId,
      startDate: expense.occurrenceDate,
      status: { not: RecurringStatus.STOPPED },
    },
    data: { status: RecurringStatus.STOPPED, statusReason: SOURCE_DELETED_REASON },
  });
  const paused = stopped.count
    ? stopped
    : await tx.recurringExpense.updateMany({
        where: {
          id: expense.recurringId,
          templateExpenseId: expense.id,
          status: RecurringStatus.ACTIVE,
        },
        data: { status: RecurringStatus.PAUSED, statusReason: LATEST_DELETED_REASON },
      });
  return paused.count ? expense.recurringId : undefined;
}

/**
 * Pauses the active rules whose next occurrence includes all of `userIds`, e.g. when one of them
 * leaves the group. Returns the ids of the rules paused, whose creators should be told.
 */
export async function pauseRulesWith(
  tx: Prisma.TransactionClient,
  { groupId, userIds, reason }: { groupId: number | null; userIds: number[]; reason: string },
) {
  const rules = await tx.recurringExpense.findMany({
    where: { groupId, status: RecurringStatus.ACTIVE, templateUserIds: { hasEvery: userIds } },
    select: { id: true },
  });
  await tx.recurringExpense.updateMany({
    where: { id: { in: rules.map((rule) => rule.id) } },
    data: { status: RecurringStatus.PAUSED, statusReason: reason },
  });
  return rules.map((rule) => rule.id);
}

/**
 * Before an account is removed, in the same transaction: rules it set up stop, and rules it is
 * part of pause. Removing it would otherwise delete expenses it paid and its rows in others, and
 * the rule must not quietly go on without them. Returns the paused rules, whose creators should
 * be told.
 */
export async function prepareAccountDeletion(tx: Prisma.TransactionClient, userId: number) {
  await tx.recurringExpense.updateMany({
    where: { createdById: userId, status: { not: RecurringStatus.STOPPED } },
    data: { status: RecurringStatus.STOPPED, statusReason: CREATOR_GONE_REASON },
  });
  const rules = await tx.recurringExpense.findMany({
    where: { status: RecurringStatus.ACTIVE, templateUserIds: { has: userId } },
    select: { id: true },
  });
  await tx.recurringExpense.updateMany({
    where: { id: { in: rules.map((rule) => rule.id) } },
    data: { status: RecurringStatus.PAUSED, statusReason: ACCOUNT_GONE_REASON },
  });
  return rules.map((rule) => rule.id);
}

/** Removes an account, pausing or stopping its recurring expenses first. */
export async function deleteUserAccount(userId: number) {
  const { user, pausedIds } = await db.$transaction(async (tx) => {
    const pausedIds = await prepareAccountDeletion(tx, userId);
    const user = await tx.user.delete({ where: { id: userId } });
    return { user, pausedIds };
  });
  return { user, pausedIds };
}

/**
 * The rule, if the caller may pause, resume or delete it: they are in the occurrence it copies
 * next (and still in its group).
 */
export async function getManageableRule(callerId: number, ruleId: number) {
  const rule = await db.recurringExpense.findUnique({ where: { id: ruleId } });
  if (!rule) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Recurring expense not found' });
  }

  if (!(await canManageRule(db, callerId, rule))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: NOT_IN_EXPENSE_MESSAGE });
  }

  return rule;
}

export async function canManageRule(
  client: Prisma.TransactionClient,
  callerId: number,
  rule: Pick<RecurringExpense, 'groupId' | 'createdById' | 'templateUserIds'>,
) {
  const isInExpense = rule.templateUserIds.length
    ? rule.templateUserIds.includes(callerId)
    : rule.createdById === callerId;
  if (!isInExpense) {
    return false;
  }

  if (null === rule.groupId) {
    return true;
  }

  return !!(await client.groupUser.findUnique({
    where: { groupId_userId: { groupId: rule.groupId, userId: callerId } },
  }));
}
/** Pauses or resumes a rule. Resuming adds nothing for the dates missed while paused. */
export async function setRulePaused(
  ruleId: number,
  paused: boolean,
  callerId: number,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    // Waits for a runner working on this rule, so the two never interleave.
    await tx.$queryRaw`SELECT id FROM "RecurringExpense" WHERE id = ${ruleId} FOR UPDATE`;
    const rule = await tx.recurringExpense.findUniqueOrThrow({ where: { id: ruleId } });

    if (RecurringStatus.STOPPED === rule.status) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: rule.statusReason ?? 'This has stopped',
      });
    }

    if (paused) {
      const caller = await tx.user.findUnique({
        where: { id: callerId },
        select: { name: true, email: true },
      });
      return tx.recurringExpense.update({
        where: { id: ruleId },
        data: { status: RecurringStatus.PAUSED, statusReason: `Paused by ${nameOf(caller)}` },
      });
    }

    const check = await checkRule(tx, rule);
    if (check.problem) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: check.problem.reason });
    }

    return tx.recurringExpense.update({
      where: { id: ruleId },
      data: {
        status: RecurringStatus.ACTIVE,
        statusReason: null,
        ...(await getNextPointer(tx, rule, rule.frequency, now)),
      },
    });
  });
}
