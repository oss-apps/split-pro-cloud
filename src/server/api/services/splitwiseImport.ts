import { Prisma, SplitType } from '@prisma/client';
import { nanoid } from 'nanoid';

import {
  type ConvertedPart,
  type ImportItemRequest,
  type ImportItemResult,
  type Ledger,
  type SplitwisePerson,
  addDebt,
  addExpense,
  convertExpense,
  createLedger,
  describeExpense,
  formatAmount,
  getNet,
  getNonGroupBalances,
  getOwed,
  getPersonName,
  isDeleted,
  isGroupExpense,
  parseAmount,
  parseLedgerKey,
} from '~/lib/splitwiseImport';
import { db } from '~/server/db';
import { MAX_AMOUNT_CENTS, toFixedNumber } from '~/utils/numbers';
import { addFriendship } from './accessControl';
import { runBalanceTransaction } from './balanceTransaction';
import {
  type ImportedExpenseInput,
  assertValidImportedExpense,
  insertImportedExpenses,
} from './splitService';

/** Splitwise expenses saved per transaction, so a long history never holds locks for long. */
export const IMPORT_BATCH_SIZE = 250;

const MAX_REASONS = 5;

class Refusal extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(' '));
  }
}

const refuse = (...reasons: string[]): never => {
  throw new Refusal(reasons.slice(0, MAX_REASONS));
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

type StoredExpense = {
  splitwiseExpenseId: string | null;
  splitwisePart: number | null;
  groupId: number | null;
  deletedAt: Date | null;
  currency: string;
  paidBy: number;
  name: string;
  expenseParticipants: { userId: number; amount: number }[];
};

const storedExpenseSelect = {
  splitwiseExpenseId: true,
  splitwisePart: true,
  groupId: true,
  deletedAt: true,
  currency: true,
  paidBy: true,
  name: true,
  expenseParticipants: { select: { userId: true, amount: true } },
} satisfies Prisma.ExpenseSelect;

/** Whether a stored expense moves the same balances as a converted part, in SplitPro ids. */
const isSameAsStored = (
  stored: StoredExpense,
  part: ConvertedPart,
  toUserId: (splitwiseId: number) => number | undefined,
) => {
  if (stored.currency !== part.currency || stored.paidBy !== toUserId(part.paidBy)) {
    return false;
  }
  const amounts = new Map(stored.expenseParticipants.map((p) => [p.userId, p.amount]));
  const nonZero = part.shares.filter((share) => 0 !== share.amount);
  return (
    nonZero.every((share) => amounts.get(toUserId(share.userId) ?? -1) === share.amount) &&
    stored.expenseParticipants.filter((p) => 0 !== p.amount).length === nonZero.length
  );
};

const describeDifferences = (
  expected: Ledger,
  actual: Ledger,
  keys: { kind: 'net' | 'pair'; key: string }[],
  name: (splitwiseId: number) => string,
  currentUserId: number,
) =>
  keys
    .map(({ kind, key }) => {
      const { currency, a, b } = parseLedgerKey(key);
      if ('net' === kind) {
        const want = getNet(expected, currency, a);
        const got = getNet(actual, currency, a);
        const describe = (amount: number) =>
          0 === amount
            ? 'settled'
            : `${0 < amount ? 'owed' : 'owing'} ${formatAmount(currency, amount)}`;
        return `Splitwise has ${name(a)} ${describe(want)}, the expenses add up to ${describe(got)}.`;
      }

      // Say it from the current user's side when they are in the pair.
      const [creditor, debtor] = b === currentUserId ? [b, a] : [a, b!];
      const describe = (amount: number) =>
        0 === amount
          ? `${name(debtor)} and ${name(creditor)} are settled`
          : 0 < amount
            ? `${name(debtor)} owes ${name(creditor)} ${formatAmount(currency, amount)}`
            : `${name(creditor)} owes ${name(debtor)} ${formatAmount(currency, amount)}`;
      return `Splitwise says ${describe(getOwed(expected, currency, debtor, creditor))}, the expenses say ${describe(getOwed(actual, currency, debtor, creditor))}.`;
    })
    .slice(0, 3);

const compareLedgers = (
  expected: Ledger,
  actual: Ledger,
  check: { nets: boolean; pairs: (key: string) => boolean },
) => {
  const differences: { kind: 'net' | 'pair'; key: string }[] = [];
  const compare = (kind: 'net' | 'pair', a: Map<string, number>, b: Map<string, number>) => {
    new Set([...a.keys(), ...b.keys()]).forEach((key) => {
      if ((a.get(key) ?? 0) !== (b.get(key) ?? 0)) {
        differences.push({ kind, key });
      }
    });
  };
  if (check.nets) {
    compare('net', expected.nets, actual.nets);
  }
  const pairs = (ledger: Ledger) => new Map([...ledger.pairs].filter(([key]) => check.pairs(key)));
  compare('pair', pairs(expected), pairs(actual));
  return differences;
};

/**
 * Imports one Splitwise group, or a set of friends' expenses outside groups, with its history.
 *
 * Nothing is written unless every check passes: the importing user takes part, everyone can be
 * matched by email, every expense converts, the balances the expenses add up to match what
 * Splitwise reports in the same file, and no pair already has a balance from the old balance-only
 * import. Expenses already imported (by Splitwise id) are skipped, so importing again is safe and
 * resumes an interrupted import.
 */
export const importSplitwiseItem = async (
  currentUser: { id: number },
  request: ImportItemRequest,
): Promise<ImportItemResult> => {
  try {
    return await importItem(currentUser.id, request);
  } catch (error) {
    if (error instanceof Refusal) {
      return { status: 'refused', reasons: error.reasons };
    }
    throw error;
  }
};

const importItem = async (
  userId: number,
  request: ImportItemRequest,
): Promise<ImportItemResult> => {
  const { item, currentUser } = request;
  const me = currentUser.id;
  const isGroup = 'group' === item.kind;

  // Everyone the file tells us about, by Splitwise id.
  const people = new Map<number, SplitwisePerson>();
  [...request.people, ...(isGroup ? item.group.members : item.friends), currentUser].forEach(
    (person) => people.set(person.id, person),
  );
  const name = (splitwiseId: number) =>
    splitwiseId === me ? 'you' : getPersonName(people.get(splitwiseId) ?? { id: splitwiseId });

  const active = request.expenses.filter((expense) => !isDeleted(expense));
  const deleted = request.expenses.filter(isDeleted);

  if (isGroup) {
    if (!item.group.members.some((member) => member.id === me)) {
      refuse("You aren't a member of this group in Splitwise.");
    }
    if (request.expenses.some((expense) => expense.group_id !== item.group.id)) {
      refuse('Some expenses belong to another group.');
    }
  } else {
    const friendIds = new Set(item.friends.map((friend) => friend.id));
    if (friendIds.has(me)) {
      refuse("You can't import yourself as a friend.");
    }
    request.expenses.forEach((expense) => {
      if (isGroupExpense(expense)) {
        refuse(`${describeExpense(expense)} belongs to a group.`);
      }
    });
    active.forEach((expense) => {
      const userIds = expense.users.map((user) => user.user_id);
      // Only expenses you are part of can be imported outside a group.
      if (!userIds.includes(me)) {
        refuse(`${describeExpense(expense)} doesn't include you.`);
      }
      if (userIds.some((id) => id !== me && !friendIds.has(id))) {
        refuse(`${describeExpense(expense)} includes someone who isn't among these friends.`);
      }
    });
  }

  // Convert every expense first, so a single bad one refuses the whole group before any write.
  const converted = new Map<string, ConvertedPart[]>();
  const errors: string[] = [];
  active.forEach((expense) => {
    const result = convertExpense(expense);
    if ('error' in result) {
      errors.push(result.error);
    } else {
      converted.set(String(expense.id), result.parts);
    }
  });
  if (errors.length) {
    refuse(...errors);
  }

  // Outside a group, every expense must stay visible to you, so you are on each part.
  if (!isGroup) {
    converted.forEach((parts) =>
      parts.forEach((part) => {
        if (!part.shares.some((share) => share.userId === me)) {
          part.isSettlement = false;
          part.shares.push({ userId: me, amount: 0 });
        }
      }),
    );
  }

  // Match everyone by email. You are always yourself, whatever email Splitwise has for you.
  const splitwiseIds = new Set<number>(
    isGroup ? item.group.members.map((member) => member.id) : item.friends.map((f) => f.id),
  );
  converted.forEach((parts) =>
    parts.forEach((part) => part.shares.forEach((share) => splitwiseIds.add(share.userId))),
  );
  splitwiseIds.delete(me);

  const emails = new Map<number, string>();
  splitwiseIds.forEach((id) => {
    const person = people.get(id);
    const email = person?.email?.trim();
    if (!person) {
      refuse(
        `Someone in these expenses (Splitwise user ${id}) is no longer in the group and isn't one of your friends, so they can't be matched.`,
      );
    } else if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      refuse(
        `${getPersonName(person)} has no email address in Splitwise, so they can't be matched.`,
      );
    } else {
      emails.set(id, normalizeEmail(email));
    }
  });

  const existingUsers = emails.size
    ? await db.user.findMany({
        where: {
          OR: [...new Set(emails.values())].map((email) => ({
            email: { equals: email, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, email: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const userIdByEmail = new Map<string, number>();
  existingUsers.forEach((user) => {
    const email = normalizeEmail(user.email ?? '');
    // Prefer the account whose email matches exactly, then the oldest.
    if (!userIdByEmail.has(email) || user.email === email) {
      userIdByEmail.set(email, user.id);
    }
  });

  const userIds = new Map<number, number | undefined>([[me, userId]]);
  emails.forEach((email, id) => userIds.set(id, userIdByEmail.get(email)));
  const seen = new Map<number, number>();
  userIds.forEach((spId, swId) => {
    if (undefined === spId) return;
    const other = seen.get(spId);
    if (undefined !== other) {
      refuse(`${name(other)} and ${name(swId)} are the same SplitPro account.`);
    }
    seen.set(spId, swId);
  });
  const splitwiseIdOf = new Map([...seen].map(([spId, swId]) => [spId, swId]));

  // A group imported before (by anyone) is reused, if you are in it.
  const existingGroup = isGroup
    ? await db.group.findUnique({
        where: { splitwiseGroupId: String(item.group.id) },
        select: { id: true, groupUsers: { select: { userId: true } } },
      })
    : null;
  if (existingGroup && !existingGroup.groupUsers.some((member) => member.userId === userId)) {
    refuse(
      'This group was already imported into SplitPro by someone else. Ask them to add you to it.',
    );
  }

  // Expenses imported before: by id from this file, and anything imported into this group.
  const fileIds = request.expenses.map((expense) => String(expense.id));
  const stored = await db.expense.findMany({
    where: {
      OR: [
        { splitwiseExpenseId: { in: fileIds } },
        ...(existingGroup
          ? [{ groupId: existingGroup.id, splitwiseExpenseId: { not: null } }]
          : []),
      ],
    },
    select: storedExpenseSelect,
  });

  const storedIds = new Set(stored.map((expense) => expense.splitwiseExpenseId!));
  stored.forEach((expense) => {
    const elsewhere = isGroup
      ? expense.groupId !== existingGroup?.id
      : null !== expense.groupId ||
        expense.expenseParticipants.some((participant) => !splitwiseIdOf.has(participant.userId));
    if (elsewhere) {
      const original = request.expenses.find((e) => String(e.id) === expense.splitwiseExpenseId);
      refuse(
        `${original ? describeExpense(original) : `"${expense.name}"`} was already imported somewhere else in SplitPro.`,
      );
    }
  });

  // The balances after this import: expenses imported before as they are now, plus new ones.
  const toUserId = (swId: number) => userIds.get(swId);
  const resulting = createLedger();
  stored
    .filter((expense) => !expense.deletedAt)
    .forEach((expense) => {
      const shares = expense.expenseParticipants.map((participant) => {
        const swId = splitwiseIdOf.get(participant.userId);
        if (undefined === swId) {
          refuse(
            `"${expense.name}", imported before, includes someone who isn't in this group now.`,
          );
        }
        return { userId: swId!, amount: participant.amount };
      });
      addExpense(resulting, {
        currency: expense.currency,
        paidBy: splitwiseIdOf.get(expense.paidBy) ?? -1,
        shares,
      });
    });

  const newExpenses = active.filter((expense) => !storedIds.has(String(expense.id)));
  const newParts = newExpenses.flatMap((expense) => converted.get(String(expense.id))!);
  newParts.forEach((part) => addExpense(resulting, part));

  // What Splitwise reports for the same group or friends.
  const expected = createLedger();
  let checkPairs: (key: string) => boolean;
  if (isGroup) {
    // Each member's balance in the group.
    item.group.members.forEach((member) =>
      (member.balance ?? []).forEach((balance) => {
        const amount = parseAmount(balance.amount);
        if (null === amount) {
          refuse(`The balance of ${name(member.id)} in this group couldn't be read.`);
        }
        const key = `${balance.currency_code}|${member.id}`;
        expected.nets.set(key, (expected.nets.get(key) ?? 0) + amount!);
      }),
    );
    // Who owes whom, before Splitwise simplifies debts.
    const debts = createLedger();
    (item.group.original_debts ?? []).forEach((debt) => {
      const amount = parseAmount(debt.amount);
      if (null === amount) {
        refuse("The group's debts couldn't be read.");
      }
      addDebt(debts, debt.currency_code, debt.from, debt.to, amount!);
    });
    expected.pairs = debts.pairs;
    const hasDebts = !!item.group.original_debts;
    checkPairs = () => hasDebts;
  } else {
    // Splitwise only reports your own balance with each friend outside groups.
    item.friends.forEach((friend) => {
      const balances = getNonGroupBalances(friend);
      if (!balances) {
        refuse(`Your balance with ${getPersonName(friend)} couldn't be read.`);
      }
      balances!.forEach(({ currency, amount }) =>
        addDebt(expected, currency, friend.id, me, amount),
      );
    });
    const friendIds = new Set(item.friends.map((friend) => friend.id));
    checkPairs = (key) => {
      const { a, b } = parseLedgerKey(key);
      return (a === me && friendIds.has(b!)) || (b === me && friendIds.has(a));
    };
  }

  const differences = compareLedgers(expected, resulting, { nets: isGroup, pairs: checkPairs });
  if (differences.length) {
    // Point at expenses that changed since they were imported, the likely cause.
    const changed = request.expenses
      .filter((expense) => storedIds.has(String(expense.id)))
      .filter((expense) => {
        const parts = stored.filter((s) => s.splitwiseExpenseId === String(expense.id));
        if (isDeleted(expense)) {
          return parts.some((part) => !part.deletedAt);
        }
        const convertedParts = converted.get(String(expense.id)) ?? [];
        return (
          parts.some((part) => part.deletedAt) ||
          parts.length !== convertedParts.length ||
          convertedParts.some((part) => {
            const match = parts.find((s) => s.splitwisePart === part.splitwisePart);
            return !match || !isSameAsStored(match, part, toUserId);
          })
        );
      })
      .slice(0, 3)
      .map(
        (expense) =>
          `${describeExpense(expense)} changed in Splitwise or SplitPro after it was imported.`,
      );

    refuse(
      "The expenses don't add up to the balances Splitwise reports, so nothing was imported.",
      ...describeDifferences(expected, resulting, differences, name, me),
      ...changed,
    );
  }

  // Check each new expense like a manual add would, before anything is saved.
  const inputsFor = (parts: ConvertedPart[], ids: Map<number, number>) =>
    parts.map(
      (part): ImportedExpenseInput => ({
        paidBy: ids.get(part.paidBy)!,
        name: part.name,
        category: part.category,
        amount: toFixedNumber(part.amount),
        splitType: part.isSettlement ? SplitType.SETTLEMENT : SplitType.EXACT,
        currency: part.currency,
        participants: part.shares.map((share) => ({
          userId: ids.get(share.userId)!,
          amount: toFixedNumber(share.amount),
        })),
        currentUserId: userId,
        expenseDate: part.expenseDate,
        splitwiseExpenseId: part.splitwiseExpenseId,
        splitwisePart: part.splitwisePart,
      }),
    );
  // Placeholder ids for people without an account yet; only their uniqueness matters here.
  const checkIds = new Map(
    [...userIds].map(([swId, spId]) => [swId, spId ?? -1_000_000 - swId] as const),
  );
  newParts.forEach((part) => {
    try {
      assertValidImportedExpense(isGroup ? 0 : null, inputsFor([part], checkIds)[0]!);
    } catch (error) {
      refuse(`"${part.name}": ${error instanceof Error ? error.message : 'not valid'}`);
    }
  });

  if (newParts.length) {
    await assertNoBalanceOnlyImport(newParts, toUserId, name);
    await assertBalancesFit(resulting, newParts, toUserId, existingGroup?.id ?? null);
  }

  // Everything checks out. From here on, write.
  const ids = await createMissingUsers(emails, userIds, people);
  const groupId = isGroup
    ? await saveGroup(userId, item.group, existingGroup?.id ?? null, ids, newParts, active)
    : null;
  if (!isGroup) {
    for (const friend of item.friends) {
      await addFriendship(userId, ids.get(friend.id)!);
    }
  }

  // Parts of one Splitwise expense are always saved together.
  for (let start = 0; start < newExpenses.length; start += IMPORT_BATCH_SIZE) {
    const batch = newExpenses.slice(start, start + IMPORT_BATCH_SIZE);
    await saveBatch(
      groupId,
      inputsFor(
        batch.flatMap((e) => converted.get(String(e.id))!),
        ids,
      ),
    );
  }

  return {
    status: 'imported',
    imported: newExpenses.length,
    alreadyImported: active.length - newExpenses.length,
    skippedDeleted: deleted.length,
    groupId,
  };
};

const saveBatch = async (groupId: number | null, inputs: ImportedExpenseInput[], attempt = 1) => {
  try {
    await runBalanceTransaction(async (tx) => {
      // Someone else may have imported some of these in the meantime.
      const existing = await tx.expense.findMany({
        where: {
          splitwiseExpenseId: { in: [...new Set(inputs.map((i) => i.splitwiseExpenseId))] },
        },
        select: { splitwiseExpenseId: true },
      });
      const existingIds = new Set(existing.map((expense) => expense.splitwiseExpenseId));
      await insertImportedExpenses(
        tx,
        groupId,
        inputs.filter((input) => !existingIds.has(input.splitwiseExpenseId)),
      );
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      'P2002' === error.code &&
      attempt < 3
    ) {
      await saveBatch(groupId, inputs, attempt + 1);
      return;
    }
    throw error;
  }
};

/**
 * Refuses when a pair already has a balance from the old balance-only import (by you or the other
 * person). That balance already includes what these expenses add up to, so it would count twice.
 */
const assertNoBalanceOnlyImport = async (
  parts: ConvertedPart[],
  toUserId: (swId: number) => number | undefined,
  name: (swId: number) => string,
) => {
  const pairs = new Map<string, [number, number]>();
  parts.forEach((part) =>
    part.shares.forEach((share) => {
      const a = toUserId(share.userId);
      const b = toUserId(part.paidBy);
      if (undefined !== a && undefined !== b && a !== b) {
        pairs.set(`${Math.min(a, b)}:${Math.max(a, b)}`, [share.userId, part.paidBy]);
      }
    }),
  );
  if (!pairs.size) {
    return;
  }

  const flagged = await db.balance.findMany({
    where: {
      importedFromSplitwise: true,
      OR: [...pairs.keys()].map((key) => {
        const [a, b] = key.split(':').map(Number) as [number, number];
        return { userId: a, friendId: b };
      }),
    },
    select: { userId: true, friendId: true },
  });

  if (flagged.length) {
    refuse(
      ...flagged.map((balance) => {
        const [a, b] = pairs.get(`${balance.userId}:${balance.friendId}`)!;
        const [first, second] = 'you' === name(b) ? [name(b), name(a)] : [name(a), name(b)];
        return `The balance between ${first} and ${second} was already imported from Splitwise without history, so importing these expenses would count it twice.`;
      }),
    );
  }
};

/** Balances are stored as 32-bit integers; refuse an import that would overflow one. */
const assertBalancesFit = async (
  resulting: Ledger,
  parts: ConvertedPart[],
  toUserId: (swId: number) => number | undefined,
  groupId: number | null,
) => {
  const delta = createLedger();
  parts.forEach((part) => addExpense(delta, part));
  const keys = [...delta.pairs.keys()]
    .map(parseLedgerKey)
    .map(({ currency, a, b }) => ({ currency, a: toUserId(a), b: toUserId(b!) }))
    .filter(
      (key): key is { currency: string; a: number; b: number } =>
        undefined !== key.a && undefined !== key.b,
    );

  const [balances, groupBalances] = await Promise.all([
    keys.length
      ? db.balance.findMany({
          where: { OR: keys.map(({ currency, a, b }) => ({ currency, userId: a, friendId: b })) },
          select: { amount: true, currency: true, userId: true, friendId: true },
        })
      : [],
    keys.length && null !== groupId
      ? db.groupBalance.findMany({
          where: {
            groupId,
            OR: keys.map(({ currency, a, b }) => ({ currency, userId: a, firendId: b })),
          },
          select: { amount: true },
        })
      : [],
  ]);

  const tooLarge =
    [...resulting.pairs.values(), ...delta.pairs.values()].some(
      (amount) => MAX_AMOUNT_CENTS < Math.abs(amount),
    ) ||
    [...balances, ...groupBalances].some(
      (balance) => MAX_AMOUNT_CENTS < Math.abs(balance.amount) + maxAbs(delta),
    );
  if (tooLarge) {
    refuse('These balances are too large for SplitPro.');
  }
};

const maxAbs = (ledger: Ledger) =>
  Math.max(0, ...[...ledger.pairs.values()].map((amount) => Math.abs(amount)));

/** Creates accounts for people who don't have one yet, like the balance-only import. */
const createMissingUsers = async (
  emails: Map<number, string>,
  userIds: Map<number, number | undefined>,
  people: Map<number, SplitwisePerson>,
) => {
  const missing = [...emails].filter(([swId]) => undefined === userIds.get(swId));
  if (missing.length) {
    await db.user.createMany({
      data: missing.map(([swId, email]) => ({ email, name: getPersonName(people.get(swId)!) })),
      skipDuplicates: true,
    });
    const created = await db.user.findMany({
      where: {
        OR: missing.map(([, email]) => ({
          email: { equals: email, mode: 'insensitive' as const },
        })),
      },
      select: { id: true, email: true },
      orderBy: { id: 'asc' },
    });
    missing.forEach(([swId, email]) => {
      const user =
        created.find((u) => u.email === email) ??
        created.find((u) => normalizeEmail(u.email ?? '') === email);
      userIds.set(swId, user?.id);
    });
  }

  return new Map([...userIds].map(([swId, spId]) => [swId, spId!]));
};

/** Creates the group with its members, or adds anyone new expenses need to an existing one. */
const saveGroup = async (
  userId: number,
  group: Extract<ImportItemRequest['item'], { kind: 'group' }>['group'],
  existingGroupId: number | null,
  ids: Map<number, number>,
  newParts: ConvertedPart[],
  active: { currency_code: string }[],
) => {
  const needed = new Set(
    newParts.flatMap((part) => part.shares.map((share) => ids.get(share.userId)!)),
  );

  if (null !== existingGroupId) {
    await db.groupUser.createMany({
      data: [...needed].map((memberId) => ({ groupId: existingGroupId, userId: memberId })),
      skipDuplicates: true,
    });
    return existingGroupId;
  }

  const members = new Set([
    userId,
    ...group.members.map((member) => ids.get(member.id)!),
    ...needed,
  ]);
  // The currency used most, for new expenses in the group.
  const counts = new Map<string, number>();
  active.forEach((expense) =>
    counts.set(expense.currency_code, (counts.get(expense.currency_code) ?? 0) + 1),
  );
  const defaultCurrency = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD';

  try {
    const created = await db.group.create({
      data: {
        name: group.name,
        splitwiseGroupId: String(group.id),
        publicId: nanoid(),
        userId,
        defaultCurrency,
        groupUsers: { create: [...members].map((memberId) => ({ userId: memberId })) },
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Someone imported the same group at the same time.
    if (error instanceof Prisma.PrismaClientKnownRequestError && 'P2002' === error.code) {
      refuse('This group is being imported by someone else right now. Try again in a minute.');
    }
    throw error;
  }
};
