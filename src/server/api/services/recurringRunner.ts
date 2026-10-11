import { Prisma, RecurringStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { db } from '~/server/db';
import { toFixedNumber } from '~/utils/numbers';
import {
  formatLocalDate,
  fromDbDate,
  getDueAt,
  getDueDates,
  getOccurrenceAfter,
  getOccurrenceExpenseDate,
  toDbDate,
} from '~/utils/recurrence';
import { runBalanceTransaction } from './balanceTransaction';
import {
  sendExpensePushNotification,
  sendRecurringStatusPushNotification,
} from './notificationService';
import { checkRule } from './recurringService';
import { insertExpense } from './splitService';

/** Set to "false" to stop adding occurrences without a deploy. Missing means enabled. */
export const RECURRING_RUNNER_ENABLED_KEY = 'recurring_runner_enabled';
/** When a tick last finished, for the health check. */
export const RECURRING_RUNNER_LAST_TICK_KEY = 'recurring_runner_last_tick_at';

/** At most this many occurrences are added per tick, so a backlog never hogs the app. */
export const MAX_OCCURRENCES_PER_TICK = 100;

type RuleOutcome =
  | { kind: 'created'; expenseId: string }
  | { kind: 'paused' }
  /** Locked or already done by another runner, or held up by a conflict: left for later. */
  | { kind: 'busy' }
  | { kind: 'failed' };

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && 'P2002' === error.code;

/** Adds the next occurrence of one rule, if it is due and no other runner is on it. */
const processRule = async (ruleId: number, now: Date): Promise<RuleOutcome> => {
  try {
    const outcome = await runBalanceTransaction(async (tx): Promise<RuleOutcome> => {
      const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM "RecurringExpense"
        WHERE id = ${ruleId} AND status = 'ACTIVE' AND "nextOccurrenceAt" <= ${now}
        FOR UPDATE SKIP LOCKED`;
      if (!locked.length) {
        return { kind: 'busy' };
      }

      const rule = await tx.recurringExpense.findUniqueOrThrow({ where: { id: ruleId } });
      const { due, skipped } = getDueDates(
        rule.frequency,
        fromDbDate(rule.startDate),
        fromDbDate(rule.nextOccurrenceDate),
        rule.timezone,
        now,
      );
      const [date] = due;
      if (!date) {
        return { kind: 'busy' };
      }
      if (skipped) {
        console.warn(
          `Recurring expense ${ruleId}: skipped ${skipped} missed occurrences from ${formatLocalDate(fromDbDate(rule.nextOccurrenceDate))}, catching up from ${formatLocalDate(date)}`,
        );
      }

      const check = await checkRule(tx, rule);
      if (check.problem) {
        await tx.recurringExpense.update({
          where: { id: ruleId },
          data: { status: check.problem.status, statusReason: check.problem.reason },
        });
        return { kind: 'paused' };
      }

      const { template, createdById } = check;
      const expense = await insertExpense(
        tx,
        rule.groupId,
        {
          paidBy: template.paidBy,
          name: template.name,
          category: template.category,
          amount: toFixedNumber(template.amount),
          splitType: template.splitType,
          currency: template.currency,
          participants: template.expenseParticipants.map((participant) => ({
            userId: participant.userId,
            amount: toFixedNumber(participant.amount),
          })),
          currentUserId: createdById,
          expenseDate: getOccurrenceExpenseDate(date, rule.timezone),
        },
        { recurringId: ruleId, occurrenceDate: toDbDate(date) },
      );

      // The new occurrence is what the next one copies, with the same people.
      const next = getOccurrenceAfter(rule.frequency, fromDbDate(rule.startDate), date);
      await tx.recurringExpense.update({
        where: { id: ruleId },
        data: {
          nextOccurrenceDate: toDbDate(next),
          nextOccurrenceAt: getDueAt(next, rule.timezone),
          templateExpenseId: expense.id,
          templateUserIds: rule.templateUserIds,
        },
      });

      return { kind: 'created', expenseId: expense.id };
    });

    if ('created' === outcome.kind) {
      sendExpensePushNotification(outcome.expenseId).catch(console.error);
    } else if ('paused' === outcome.kind) {
      sendRecurringStatusPushNotification(ruleId).catch(console.error);
    }
    return outcome;
  } catch (error) {
    // Another instance added it first, or the balances were too busy (see #23): the next tick
    // finds the pointer moved on, or tries again.
    if (isUniqueViolation(error) || (error instanceof TRPCError && 'CONFLICT' === error.code)) {
      return { kind: 'busy' };
    }

    // The copy itself is invalid (e.g. a balance would get too large): this won't pass later
    // either, so pause it and tell its creator rather than retrying forever.
    if (error instanceof TRPCError && 'BAD_REQUEST' === error.code) {
      const { count } = await db.recurringExpense.updateMany({
        where: { id: ruleId, status: RecurringStatus.ACTIVE },
        data: {
          status: RecurringStatus.PAUSED,
          statusReason: `It couldn't be added: ${error.message}`,
        },
      });
      if (count) {
        sendRecurringStatusPushNotification(ruleId).catch(console.error);
      }
      return { kind: 'paused' };
    }

    console.error(`Recurring expense ${ruleId}: failed to add an occurrence`, error);
    return { kind: 'failed' };
  }
};

export type TickResult = {
  skipped: boolean;
  created: number;
  paused: number;
  deferred: number;
  failed: number;
};

/**
 * Adds every due occurrence, up to `limit`. Safe to run on several instances at once: each rule is
 * locked while it is worked on, and an occurrence can only exist once per date.
 */
export async function runRecurringTick({
  now = new Date(),
  limit = MAX_OCCURRENCES_PER_TICK,
}: { now?: Date; limit?: number } = {}): Promise<TickResult> {
  const result = { skipped: false, created: 0, paused: 0, deferred: 0, failed: 0 };

  const enabled = await db.appMetadata.findUnique({ where: { key: RECURRING_RUNNER_ENABLED_KEY } });
  if ('false' === enabled?.value) {
    return { ...result, skipped: true };
  }

  // Rules left for the next tick, so a busy or failing one isn't tried again and again.
  const leftForLater: number[] = [];
  let attempts = 0;
  while (attempts < limit) {
    const due = await db.recurringExpense.findMany({
      where: {
        status: RecurringStatus.ACTIVE,
        nextOccurrenceAt: { lte: now },
        id: { notIn: leftForLater },
      },
      orderBy: [{ nextOccurrenceAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: limit - attempts,
    });
    if (!due.length) {
      break;
    }

    for (const { id } of due) {
      attempts += 1;
      const outcome = await processRule(id, now);
      if ('created' === outcome.kind) {
        result.created += 1;
      } else if ('paused' === outcome.kind) {
        result.paused += 1;
      } else {
        result[outcome.kind === 'busy' ? 'deferred' : 'failed'] += 1;
        leftForLater.push(id);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  await db.appMetadata.upsert({
    where: { key: RECURRING_RUNNER_LAST_TICK_KEY },
    create: { key: RECURRING_RUNNER_LAST_TICK_KEY, value: finishedAt },
    update: { value: finishedAt },
  });

  return result;
}

const RUNNER_STARTED = Symbol.for('splitpro.recurringRunner');

/**
 * Runs a tick shortly after startup and then every `intervalMs`, with a little jitter so instances
 * drift apart. The timer only triggers ticks; what is due and done lives in the database.
 */
export function startRecurringRunner(intervalMs = 5 * 60 * 1000) {
  const state = globalThis as typeof globalThis & { [RUNNER_STARTED]?: boolean };
  if (state[RUNNER_STARTED]) {
    return;
  }
  state[RUNNER_STARTED] = true;

  const jitter = () => Math.random() * Math.min(30_000, intervalMs / 10);
  let isRunning = false;

  const tick = async () => {
    if (isRunning) {
      return;
    }
    isRunning = true;
    try {
      const result = await runRecurringTick();
      if (result.created || result.paused || result.failed) {
        console.info('Recurring expenses:', result);
      }
    } catch (error) {
      console.error('Recurring expenses: tick failed', error);
    } finally {
      isRunning = false;
    }
  };

  const schedule = (delay: number) => {
    setTimeout(() => {
      tick()
        .catch(console.error)
        .finally(() => schedule(intervalMs + jitter()));
    }, delay).unref();
  };

  console.info(`Recurring expenses: runner started, every ${Math.round(intervalMs / 1000)}s`);
  schedule(Math.min(30_000, intervalMs) + jitter());
}
