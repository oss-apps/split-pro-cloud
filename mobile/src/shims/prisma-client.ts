/**
 * Metro serves this file for every `@prisma/client` import (see metro.config.js), because shared
 * web files like ../src/utils/splits.ts import runtime enums from it and the real package can't run
 * in React Native. Only enums belong here. Type-only imports are erased at build time and keep
 * resolving to the real package in TypeScript. `satisfies` fails typecheck if the schema's enums
 * change and this file wasn't updated.
 */
/* eslint-disable @typescript-eslint/no-redeclare -- a value and a type per enum, like Prisma's */
import type * as Prisma from '@prisma/client';

export const SplitType = {
  EQUAL: 'EQUAL',
  PERCENTAGE: 'PERCENTAGE',
  EXACT: 'EXACT',
  SHARE: 'SHARE',
  ADJUSTMENT: 'ADJUSTMENT',
  SETTLEMENT: 'SETTLEMENT',
} as const satisfies typeof Prisma.SplitType;
export type SplitType = Prisma.SplitType;

export const RecurringFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  LAST_DAY_OF_MONTH: 'LAST_DAY_OF_MONTH',
  YEARLY: 'YEARLY',
} as const satisfies typeof Prisma.RecurringFrequency;
export type RecurringFrequency = Prisma.RecurringFrequency;

export const RecurringStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
} as const satisfies typeof Prisma.RecurringStatus;
export type RecurringStatus = Prisma.RecurringStatus;
