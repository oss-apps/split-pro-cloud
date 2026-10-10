import { type Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { createTRPCRouter, publicProcedure } from '~/server/api/trpc';
import { type db as Db } from '~/server/db';
import { type RateLimitRule, consumeRateLimit } from '~/server/rateLimit';

export const QUICK_SPLIT_MAX_PEOPLE = 20;
export const QUICK_SPLIT_MAX_EXPENSES = 300;

const MAX_AMOUNT = 1_000_000_000;
const WRITE_LIMIT: RateLimitRule = { name: 'quick-split-write:ip:1m', limit: 120, windowSeconds: 60 };
const CREATE_LIMIT: RateLimitRule = { name: 'quick-split-create:ip:1h', limit: 20, windowSeconds: 3600 };

const throttle = async (rule: RateLimitRule, ip: string) => {
  const { allowed } = await consumeRateLimit(rule, ip);
  if (!allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many changes in a short time. Please wait a minute and try again.',
    });
  }
};

const splitId = z.string().regex(/^[\w-]{21}$/);
const personName = z.string().trim().min(1).max(40);
const amount = z.number().int().min(1).max(MAX_AMOUNT);

const include = {
  people: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  expenses: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.QuickSplitInclude;

type Tx = Prisma.TransactionClient | typeof Db;

const loadSplit = async (tx: Tx, id: string) => {
  const split = await tx.quickSplit.findUnique({ where: { id }, include });
  if (!split) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'This split does not exist.' });
  }
  return {
    id: split.id,
    name: split.name,
    currency: split.currency,
    updatedAt: split.updatedAt,
    people: split.people.map((p) => ({ id: p.id, name: p.name })),
    expenses: split.expenses.map((e) => ({
      id: e.id,
      title: e.title,
      amount: e.amount,
      paidBy: e.paidBy,
      splitAmong: e.splitAmong,
      ...(e.exact.length ? { exact: e.exact } : {}),
      ...(e.isPayment ? { payment: true } : {}),
    })),
  };
};

export type QuickSplitData = Awaited<ReturnType<typeof loadSplit>>;

const touch = (tx: Tx, id: string) =>
  tx.quickSplit.update({ where: { id }, data: { updatedAt: new Date() } });

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });

/** Throttles writes per IP, then runs the change and returns the updated split. */
const mutate = async (
  ctx: { db: typeof Db; ip: string },
  id: string,
  change: (tx: Prisma.TransactionClient, split: QuickSplitData) => Promise<unknown>,
) => {
  await throttle(WRITE_LIMIT, ctx.ip);
  return ctx.db.$transaction(async (tx) => {
    const split = await loadSplit(tx, id);
    await change(tx, split);
    await touch(tx, id);
    return loadSplit(tx, id);
  });
};

const ExpenseInput = z.object({
  id: splitId,
  expenseId: z.string().max(40).optional(),
  title: z.string().trim().max(80),
  amount,
  paidBy: z.string().max(40),
  splitAmong: z.array(z.string().max(40)).min(1).max(QUICK_SPLIT_MAX_PEOPLE),
  exact: z.array(z.number().int().min(0).max(MAX_AMOUNT)).max(QUICK_SPLIT_MAX_PEOPLE).optional(),
});

const validateExpense = (split: QuickSplitData, input: z.infer<typeof ExpenseInput>) => {
  const personIds = new Set(split.people.map((p) => p.id));
  if (!personIds.has(input.paidBy)) {
    throw badRequest('The person who paid is no longer in this split.');
  }
  if (
    new Set(input.splitAmong).size !== input.splitAmong.length ||
    input.splitAmong.some((personId) => !personIds.has(personId))
  ) {
    throw badRequest('Someone in this expense is no longer in this split.');
  }
  if (input.exact) {
    const sum = input.exact.reduce((acc, part) => acc + part, 0);
    if (input.exact.length !== input.splitAmong.length || sum !== input.amount) {
      throw badRequest('The exact amounts must add up to the total.');
    }
  }
};

export const quickSplitRouter = createTRPCRouter({
  get: publicProcedure
    .input(z.object({ id: splitId }))
    .query(({ ctx, input }) => loadSplit(ctx.db, input.id)),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().trim().max(60),
        currency: z.string().length(3),
        people: z.array(personName).min(2).max(QUICK_SPLIT_MAX_PEOPLE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await throttle(CREATE_LIMIT, ctx.ip);
      const id = nanoid();
      await ctx.db.quickSplit.create({
        data: {
          id,
          name: input.name,
          currency: input.currency.toUpperCase(),
          people: { create: input.people.map((name) => ({ name })) },
        },
      });
      return { id };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: splitId,
        name: z.string().trim().max(60).optional(),
        currency: z.string().length(3).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx, split) => {
        if (input.currency && input.currency !== split.currency && split.expenses.length) {
          throw badRequest('The currency cannot change once there are expenses.');
        }
        await tx.quickSplit.update({
          where: { id: input.id },
          data: { name: input.name, currency: input.currency?.toUpperCase() },
        });
      }),
    ),

  addPerson: publicProcedure
    .input(z.object({ id: splitId, name: personName }))
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx, split) => {
        if (split.people.length >= QUICK_SPLIT_MAX_PEOPLE) {
          throw badRequest(`A split can have up to ${QUICK_SPLIT_MAX_PEOPLE} people.`);
        }
        await tx.quickSplitPerson.create({ data: { splitId: input.id, name: input.name } });
      }),
    ),

  renamePerson: publicProcedure
    .input(z.object({ id: splitId, personId: z.string().max(40), name: personName }))
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx) => {
        const { count } = await tx.quickSplitPerson.updateMany({
          where: { id: input.personId, splitId: input.id },
          data: { name: input.name },
        });
        if (!count) {
          throw badRequest('This person was removed from the split.');
        }
      }),
    ),

  removePerson: publicProcedure
    .input(z.object({ id: splitId, personId: z.string().max(40) }))
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx, split) => {
        if (split.people.length <= 2) {
          throw badRequest('A split needs at least two people.');
        }
        if (
          split.expenses.some(
            (e) => e.paidBy === input.personId || e.splitAmong.includes(input.personId),
          )
        ) {
          throw badRequest('Remove their expenses first.');
        }
        await tx.quickSplitPerson.deleteMany({ where: { id: input.personId, splitId: input.id } });
      }),
    ),

  saveExpense: publicProcedure.input(ExpenseInput).mutation(({ ctx, input }) =>
    mutate(ctx, input.id, async (tx, split) => {
      validateExpense(split, input);
      const data = {
        title: input.title,
        amount: input.amount,
        paidBy: input.paidBy,
        splitAmong: input.splitAmong,
        exact: input.exact ?? [],
      };

      if (!input.expenseId) {
        if (split.expenses.length >= QUICK_SPLIT_MAX_EXPENSES) {
          throw badRequest(`A split can have up to ${QUICK_SPLIT_MAX_EXPENSES} expenses.`);
        }
        await tx.quickSplitExpense.create({ data: { ...data, splitId: input.id } });
        return;
      }

      const { count } = await tx.quickSplitExpense.updateMany({
        where: { id: input.expenseId, splitId: input.id, isPayment: false },
        data,
      });
      if (!count) {
        throw badRequest('Someone else deleted this expense.');
      }
    }),
  ),

  recordPayment: publicProcedure
    .input(
      z.object({
        id: splitId,
        from: z.string().max(40),
        to: z.string().max(40),
        amount,
      }),
    )
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx, split) => {
        const personIds = new Set(split.people.map((p) => p.id));
        if (input.from === input.to || !personIds.has(input.from) || !personIds.has(input.to)) {
          throw badRequest('Both people must be in this split.');
        }
        if (split.expenses.length >= QUICK_SPLIT_MAX_EXPENSES) {
          throw badRequest(`A split can have up to ${QUICK_SPLIT_MAX_EXPENSES} expenses.`);
        }
        await tx.quickSplitExpense.create({
          data: {
            splitId: input.id,
            title: '',
            amount: input.amount,
            paidBy: input.from,
            splitAmong: [input.to],
            isPayment: true,
          },
        });
      }),
    ),

  deleteExpense: publicProcedure
    .input(z.object({ id: splitId, expenseId: z.string().max(40) }))
    .mutation(({ ctx, input }) =>
      mutate(ctx, input.id, async (tx) => {
        await tx.quickSplitExpense.deleteMany({
          where: { id: input.expenseId, splitId: input.id },
        });
      }),
    ),
});
