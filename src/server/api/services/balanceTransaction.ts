import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { db } from '~/server/db';
import { AMOUNT_TOO_LARGE_MESSAGE } from '~/utils/numbers';

const MAX_TRANSACTION_ATTEMPTS = 5;

export const BALANCE_CONFLICT_MESSAGE =
  'Someone else updated these balances at the same time. Please try again.';

const isSerializationFailure = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // A raw query, e.g. locking a row, reports the database's own code.
    return (
      'P2034' === error.code ||
      ('P2010' === error.code && ['40001', '40P01'].includes(String(error.meta?.code)))
    );
  }

  // Serialization failures raised mid-query can surface without a Prisma error code.
  return (
    error instanceof Error &&
    /could not serialize access|deadlock detected|40001|40P01/.test(error.message)
  );
};

// Amounts and balances are int4 cents. A running balance can overflow even when every amount fits.
export const isIntegerOverflow = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && 'P2020' === error.code) {
    return true;
  }

  return (
    error instanceof Error &&
    /\b22003\b|integer out of range|Unable to fit integer value/.test(error.message)
  );
};

export const runBalanceTransaction = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  attempt = 1,
): Promise<T> => {
  try {
    return await db.$transaction(operation, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 20_000,
    });
  } catch (error) {
    if (isIntegerOverflow(error)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: AMOUNT_TOO_LARGE_MESSAGE, cause: error });
    }

    if (!isSerializationFailure(error)) {
      throw error;
    }

    if (MAX_TRANSACTION_ATTEMPTS <= attempt) {
      throw new TRPCError({ code: 'CONFLICT', message: BALANCE_CONFLICT_MESSAGE, cause: error });
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 25 + Math.random() * 50));
    return runBalanceTransaction(operation, attempt + 1);
  }
};
