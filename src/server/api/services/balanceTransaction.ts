import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { db } from '~/server/db';

const MAX_TRANSACTION_ATTEMPTS = 5;

export const BALANCE_CONFLICT_MESSAGE =
  'Someone else updated these balances at the same time. Please try again.';

const isSerializationFailure = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return 'P2034' === error.code;
  }

  // Serialization failures raised mid-query can surface without a Prisma error code.
  return (
    error instanceof Error &&
    /could not serialize access|deadlock detected|40001|40P01/.test(error.message)
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
