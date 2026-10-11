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
  toDbDate,
} from '~/utils/recurrence';
import { getKnownUserIds } from './accessControl';

export const recurrenceInputSchema = z.object({
  frequency: z.enum(RECURRING_FREQUENCIES),
  timezone: z.string().refine(isValidTimeZone, { message: 'Unknown time zone' }),
});

export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

export const ACCOUNT_GONE_REASON = "Someone in this expense doesn't have an account anymore";
export const SOURCE_DELETED_REASON = 'The first expense was deleted';

type RuleProblem = { status: RecurringStatus; reason: string };

const nameOf = (user: { name: string | null; email: string | null } | null | undefined) =>
  user?.name ?? user?.email ?? 'Someone';

const joinNames = (names: string[]) =>
  1 < names.length ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

/** The latest occurrence that isn't deleted, which the next one copies. */
export const getTemplate = (tx: Prisma.TransactionClient, recurringId: number) =>
  tx.expense.findFirst({
    where: { recurringId, deletedAt: null },
    orderBy: { occurrenceDate: 'desc' },
    include: {
      expenseParticipants: { include: { user: { select: { name: true, email: true } } } },
    },
  });

type Template = NonNullable<Awaited<ReturnType<typeof getTemplate>>>;

const getTemplateUserIds = (template: Pick<Template, 'paidBy' | 'expenseParticipants'>) => [
  ...new Set([template.paidBy, ...template.expenseParticipants.map((p) => p.userId)]),
];

/** The latest date the rule has an occurrence for, deleted ones included. */
const getLatestOccurrenceDate = async (tx: Prisma.TransactionClient, rule: RecurringExpense) => {
  const latest = await tx.expense.findFirst({
    where: { recurringId: rule.id },
    orderBy: { occurrenceDate: 'desc' },
    select: { occurrenceDate: true },
  });
  return fromDbDate(latest?.occurrenceDate ?? rule.startDate);
};

/**
 * Whether the rule can add its next occurrence, and the occurrence it would copy. Rules that can't
 * are paused (or stopped, once their first expense is deleted) instead of adding a wrong expense.
 */
export async function checkRule(
  tx: Prisma.TransactionClient,
  rule: Pick<RecurringExpense, 'id' | 'groupId' | 'createdById' | 'startDate'>,
): Promise<{ template: Template; problem?: undefined } | { problem: RuleProblem }> {
  const source = await tx.expense.findUnique({
    where: { recurringId_occurrenceDate: { recurringId: rule.id, occurrenceDate: rule.startDate } },
    select: { deletedAt: true },
  });
  if (source?.deletedAt) {
    return { problem: { status: RecurringStatus.STOPPED, reason: SOURCE_DELETED_REASON } };
  }

  const template = await getTemplate(tx, rule.id);
  // Expenses are only ever removed for good with the account of the person who paid them.
  if (!source || !template) {
    return { problem: { status: RecurringStatus.PAUSED, reason: ACCOUNT_GONE_REASON } };
  }

  // Each saved expense adds up to zero. Without someone's row, their account was removed.
  const total = template.expenseParticipants.reduce((sum, p) => sum + p.amount, 0);
  if (0 !== total || !template.expenseParticipants.some((p) => p.userId === template.paidBy)) {
    return { problem: { status: RecurringStatus.PAUSED, reason: ACCOUNT_GONE_REASON } };
  }

  if (SplitType.SETTLEMENT === template.splitType) {
    return { problem: { status: RecurringStatus.PAUSED, reason: "Payments can't repeat" } };
  }

  const userIds = getTemplateUserIds(template);
  const names = new Map(template.expenseParticipants.map((p) => [p.userId, nameOf(p.user)]));
  const creator = await tx.user.findUnique({
    where: { id: rule.createdById },
    select: { name: true, email: true },
  });
  names.set(rule.createdById, nameOf(creator));

  if (null !== rule.groupId) {
    const members = await tx.groupUser.findMany({
      where: { groupId: rule.groupId, userId: { in: [...userIds, rule.createdById] } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const gone = [...new Set([...userIds, rule.createdById])].filter((id) => !memberIds.has(id));
    if (gone.length) {
      return {
        problem: {
          status: RecurringStatus.PAUSED,
          reason: `${joinNames(gone.map((id) => names.get(id) ?? 'Someone'))} left the group`,
        },
      };
    }
    return { template };
  }

  // Without a group, it is added by its creator, who has to be part of it like for any expense.
  if (!userIds.includes(rule.createdById)) {
    return {
      problem: {
        status: RecurringStatus.PAUSED,
        reason: `${names.get(rule.createdById)} isn't part of this expense anymore`,
      },
    };
  }
  const known = await getKnownUserIds(rule.createdById, userIds);
  const unknown = userIds.filter((id) => !known.has(id));
  if (unknown.length) {
    return {
      problem: {
        status: RecurringStatus.PAUSED,
        reason: `${names.get(rule.createdById)} and ${joinNames(unknown.map((id) => names.get(id) ?? 'Someone'))} aren't friends anymore`,
      },
    };
  }

  return { template };
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
 * Sets how a saved expense repeats, in the transaction that saves it. A new rule starts from the
 * expense's date and adds its first occurrence on the next date of the schedule from today on.
 * Changing the frequency keeps the rule (and whether it is paused); `null` removes it, keeping the
 * expenses it added.
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
  // A stopped rule is history only. Repeating one of its expenses starts a new rule.
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

  // A saved expense may be older than today's checks, e.g. without the payer's own row.
  const check = await checkRule(tx, {
    id: occurrence.recurringId,
    groupId: expense.groupId,
    createdById: userId,
    startDate: occurrence.occurrenceDate,
  });
  if (check.problem) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: check.problem.reason });
  }
}

/** Deleting the expense a rule was set up on stops it. Other occurrences just stay deleted. */
export async function stopRuleOfDeletedSource(
  tx: Prisma.TransactionClient,
  expense: { recurringId: number | null; occurrenceDate: Date | null },
) {
  if (null === expense.recurringId || null === expense.occurrenceDate) {
    return;
  }

  await tx.recurringExpense.updateMany({
    where: {
      id: expense.recurringId,
      startDate: expense.occurrenceDate,
      status: { not: RecurringStatus.STOPPED },
    },
    data: { status: RecurringStatus.STOPPED, statusReason: SOURCE_DELETED_REASON },
  });
}

/**
 * Pauses the active rules whose latest occurrence includes all of `userIds`, e.g. when one of them
 * leaves the group. Returns the ids of the rules paused, whose creators should be told.
 */
export async function pauseRulesWith(
  tx: Prisma.TransactionClient,
  { groupId, userIds, reason }: { groupId: number | null; userIds: number[]; reason: string },
) {
  const rules = await tx.recurringExpense.findMany({
    where: {
      groupId,
      status: RecurringStatus.ACTIVE,
      AND: userIds.map((userId) => ({
        occurrences: {
          some: {
            deletedAt: null,
            OR: [{ paidBy: userId }, { expenseParticipants: { some: { userId } } }],
          },
        },
      })),
    },
    select: { id: true },
  });

  const paused: number[] = [];
  for (const rule of rules) {
    const template = await getTemplate(tx, rule.id);
    const templateUserIds = template ? getTemplateUserIds(template) : [];
    if (userIds.every((id) => templateUserIds.includes(id))) {
      await tx.recurringExpense.update({
        where: { id: rule.id },
        data: { status: RecurringStatus.PAUSED, statusReason: reason },
      });
      paused.push(rule.id);
    }
  }

  return paused;
}

/**
 * The rule, if the caller may pause, resume or delete it: they are in its latest occurrence (and
 * still in its group).
 */
export async function getManageableRule(callerId: number, ruleId: number) {
  const rule = await db.recurringExpense.findUnique({ where: { id: ruleId } });
  if (!rule) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Recurring expense not found' });
  }

  if (!(await canManageRule(callerId, rule))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only people in this expense can change how it repeats',
    });
  }

  return rule;
}

export async function canManageRule(
  callerId: number,
  rule: Pick<RecurringExpense, 'id' | 'groupId' | 'createdById'>,
) {
  const template = await getTemplate(db, rule.id);
  const isInExpense = template
    ? getTemplateUserIds(template).includes(callerId)
    : rule.createdById === callerId;
  if (!isInExpense) {
    return false;
  }

  if (null === rule.groupId) {
    return true;
  }

  return !!(await db.groupUser.findUnique({
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
