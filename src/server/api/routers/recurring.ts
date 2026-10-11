import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTRPCRouter, groupProcedure, protectedProcedure } from '~/server/api/trpc';
import { db } from '~/server/db';
import { canViewExpense } from '../services/accessControl';
import { canManageRule, getManageableRule, setRulePaused } from '../services/recurringService';

const ruleInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  occurrences: {
    where: { deletedAt: null },
    orderBy: { occurrenceDate: 'desc' },
    take: 1,
    select: {
      id: true,
      name: true,
      amount: true,
      currency: true,
      paidBy: true,
      groupId: true,
      expenseParticipants: { select: { userId: true } },
    },
  },
} as const;

type RuleWithLatest = Awaited<
  ReturnType<typeof db.recurringExpense.findMany<{ include: typeof ruleInclude }>>
>[number];

const toRuleView = async (rule: RuleWithLatest, callerId: number) => {
  const { occurrences, ...rest } = rule;
  return {
    ...rest,
    latest: occurrences[0] ?? null,
    canManage: await canManageRule(callerId, rule),
  };
};

export const recurringRouter = createTRPCRouter({
  /** The group's recurring expenses, for its settings. */
  getGroupRules: groupProcedure.query(async ({ input, ctx }) => {
    const rules = await db.recurringExpense.findMany({
      where: { groupId: input.groupId },
      include: ruleInclude,
      orderBy: [{ status: 'asc' }, { nextOccurrenceAt: 'asc' }],
    });
    return Promise.all(rules.map((rule) => toRuleView(rule, ctx.session.user.id)));
  }),

  /** How an expense repeats, for anyone who can see one of its expenses. */
  getRule: protectedProcedure
    .input(z.object({ ruleId: z.number() }))
    .query(async ({ input, ctx }) => {
      const rule = await db.recurringExpense.findUnique({
        where: { id: input.ruleId },
        include: ruleInclude,
      });
      const latest = rule?.occurrences[0];
      if (!rule || !latest || !(await canViewExpense(ctx.session.user.id, latest))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recurring expense not found' });
      }
      return toRuleView(rule, ctx.session.user.id);
    }),

  setPaused: protectedProcedure
    .input(z.object({ ruleId: z.number(), paused: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await getManageableRule(ctx.session.user.id, input.ruleId);
      return setRulePaused(input.ruleId, input.paused, ctx.session.user.id);
    }),

  /** Stops repeating for good. The expenses it added stay. */
  delete: protectedProcedure
    .input(z.object({ ruleId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await getManageableRule(ctx.session.user.id, input.ruleId);
      await db.recurringExpense.delete({ where: { id: input.ruleId } });
    }),
});
