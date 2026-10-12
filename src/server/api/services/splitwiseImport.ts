import { Prisma, SplitType } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';

import {
  type ConvertedPart,
  type ImportItemRequest,
  type ImportItemResult,
  type Ledger,
  type SplitwiseExpense,
  type SplitwisePerson,
  addDebt,
  addExpense,
  convertExpense,
  createLedger,
  describeExpense,
  describeExpenseWithId,
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
import { getKnownUserIds } from './accessControl';
import { BALANCE_CONFLICT_MESSAGE, runBalanceTransaction } from './balanceTransaction';
import {
  type ImportedExpenseInput,
  ImportedExpenseMismatchError,
  assertValidImportedExpense,
  describeImportedElsewhere,
  insertImportedExpenses,
  isSameImportedExpense,
  isSameSplitwiseExpense,
} from './splitService';
import {
  LostImportLockError,
  acquireImportLocks,
  BalanceOnlyPeopleError,
  claimHistoryPeople,
  getBalanceOnlyPeople,
  releaseImportLocks,
  renewImportLocks,
} from './splitwiseImportLocks';

/** Splitwise expenses saved per transaction, so a long history never holds locks for long. */
export const IMPORT_BATCH_SIZE = 250;

/**
 * Set to "true" to allow importing expense history. Missing or anything else means off: the server
 * refuses history imports and the page offers the balance-only import, as before. It stays off
 * until no older version of the app (which doesn't check the rules below) is running.
 */
export const HISTORY_IMPORT_ENABLED_KEY = 'splitwise_history_import_enabled';

export const isHistoryImportEnabled = async () =>
  'true' ===
  (await db.appMetadata.findUnique({ where: { key: HISTORY_IMPORT_ENABLED_KEY } }))?.value;

export const HISTORY_IMPORT_OFF_MESSAGE =
  "Importing expense history from Splitwise isn't turned on yet. You can still import balances.";

/** How long an import waits for another import of the same group or friends to finish. */
export const IMPORT_LOCK_WAIT_MS = 15_000;

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

const joinNames = (names: string[]) =>
  1 < names.length ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

/**
 * Where an imported expense belongs. Splitwise ids are only trusted within it: a group in SplitPro,
 * or, outside groups, the exact set of people in the expense, which always includes whoever
 * imported it. So an id in one person's file can never stand for an expense elsewhere.
 */
const groupScope = (groupId: number) => `group:${groupId}`;
const usersScope = (userIds: number[]) =>
  `users:${[...new Set(userIds)].sort((a, b) => a - b).join(',')}`;

const storedExpenseSelect = {
  splitwiseExpenseId: true,
  splitwiseScope: true,
  splitwisePart: true,
  groupId: true,
  addedBy: true,
  deletedAt: true,
  amount: true,
  currency: true,
  paidBy: true,
  splitType: true,
  name: true,
  expenseParticipants: { select: { userId: true, amount: true } },
} satisfies Prisma.ExpenseSelect;

type StoredExpense = Prisma.ExpenseGetPayload<{ select: typeof storedExpenseSelect }>;

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
      const owes = (from: number, to: number, amount: number) =>
        `${name(from)} ${'you' === name(from) ? 'owe' : 'owes'} ${name(to)} ${formatAmount(currency, amount)}`;
      const describe = (amount: number) =>
        0 === amount
          ? `${name(debtor)} and ${name(creditor)} are settled`
          : 0 < amount
            ? owes(debtor, creditor, amount)
            : owes(creditor, debtor, amount);
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
 * Only one import of the same group (or pair of friends) runs at a time. Nothing is written unless
 * every check passes: the importing user takes part, everyone can be matched by email, every
 * expense converts exactly, expenses imported before move the same money as in the file, the
 * balances the expenses add up to match what Splitwise reports in the same file, and no pair's
 * balance was imported without history. Expenses imported before are skipped, so importing again
 * is safe and finishes an interrupted import.
 */
export const importSplitwiseItem = async (
  currentUser: { id: number },
  request: ImportItemRequest,
  { lockWaitMs = IMPORT_LOCK_WAIT_MS }: { lockWaitMs?: number } = {},
): Promise<ImportItemResult> => {
  if (!(await isHistoryImportEnabled())) {
    return { status: 'refused', reasons: [HISTORY_IMPORT_OFF_MESSAGE] };
  }

  const { item, currentUser: me } = request;
  const keys =
    'group' === item.kind
      ? [`splitwise-group:${item.group.id}`]
      : item.friends.map(
          (friend) => `splitwise-pair:${Math.min(me.id, friend.id)}:${Math.max(me.id, friend.id)}`,
        );
  const token = await acquireImportLocks(keys, lockWaitMs);
  if (!token) {
    return {
      status: 'refused',
      reasons: [
        'group' === item.kind
          ? 'An import of this group is already running. Try again in a minute.'
          : 'An import with these friends is already running. Try again in a minute.',
      ],
    };
  }

  try {
    return await importItem(currentUser.id, request, () =>
      renewImportLocks(token, new Set(keys).size),
    );
  } catch (error) {
    if (error instanceof Refusal) {
      return { status: 'refused', reasons: error.reasons };
    }
    throw error;
  } finally {
    await releaseImportLocks(token).catch(console.error);
  }
};

const importItem = async (
  userId: number,
  request: ImportItemRequest,
  renewLocks: () => Promise<void>,
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
          // A settle up is between exactly two people.
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
  request.expenses.forEach((expense) =>
    expense.users.forEach((user) => splitwiseIds.add(user.user_id)),
  );
  splitwiseIds.delete(me);

  const emails = new Map<number, string>();
  const byEmail = new Map<string, number>();
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
      const normalized = normalizeEmail(email);
      const other = byEmail.get(normalized);
      // Two people would become one account, and their balances would merge.
      if (undefined !== other) {
        refuse(`${name(other)} and ${name(id)} have the same email address in Splitwise.`);
      }
      byEmail.set(normalized, id);
      emails.set(id, normalized);
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
  const toUserId = (swId: number) => userIds.get(swId);

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

  /** The scope an expense in the file belongs to, or null if nothing can be saved in it yet. */
  const scopeOf = (expense: SplitwiseExpense) => {
    if (isGroup) {
      return existingGroup ? groupScope(existingGroup.id) : null;
    }
    const ids = expense.users.map((user) => toUserId(user.user_id));
    return ids.every((id) => undefined !== id) ? usersScope(ids as number[]) : null;
  };
  /** The SplitPro accounts of the people who paid or owe something in an expense, if they exist. */
  const partiesOf = (expense: SplitwiseExpense) =>
    new Set(
      expense.users
        .filter((user) => 0 !== parseAmount(user.paid_share) || 0 !== parseAmount(user.owed_share))
        .map((user) => toUserId(user.user_id))
        .filter((id): id is number => undefined !== id),
    );

  const fileById = new Map(request.expenses.map((expense) => [String(expense.id), expense]));
  const stored = await db.expense.findMany({
    where: {
      OR: [
        { splitwiseExpenseId: { in: [...fileById.keys()] } },
        ...(existingGroup
          ? [{ groupId: existingGroup.id, splitwiseExpenseId: { not: null } }]
          : []),
      ],
    },
    select: storedExpenseSelect,
  });

  // Expenses already saved in the same scope; anything this import adds would be a copy.
  const inScope: StoredExpense[] = [];
  stored.forEach((row) => {
    const expense = fileById.get(row.splitwiseExpenseId!);
    if (existingGroup && row.splitwiseScope === groupScope(existingGroup.id)) {
      inScope.push(row);
      return;
    }
    if (!expense) {
      return;
    }
    if (row.splitwiseScope === scopeOf(expense)) {
      inScope.push(row);
      return;
    }
    // The same Splitwise id saved elsewhere is the same expense if it involves you or any of the
    // same people: it moved between groups in Splitwise, or someone else in it imported it with
    // other people. It's never saved twice. An id with nothing in common is someone else's, so it
    // can't block this import or change anyone's money.
    if (isSameSplitwiseExpense(row, userId, partiesOf(expense))) {
      refuse(describeImportedElsewhere(describeExpenseWithId(expense), row.groupId));
    }
  });

  // What was saved before must move exactly the same money as the file says now.
  const storedById = new Map<string, StoredExpense[]>();
  inScope.forEach((row) =>
    storedById.set(row.splitwiseExpenseId!, [
      ...(storedById.get(row.splitwiseExpenseId!) ?? []),
      row,
    ]),
  );
  const changed: string[] = [];
  storedById.forEach((rows, id) => {
    const expense = fileById.get(id);
    const parts = converted.get(id);
    if (!expense || !parts) {
      return;
    }
    const inUserIds = parts.map((part) => ({
      ...part,
      paidBy: toUserId(part.paidBy) ?? -1,
      shares: part.shares.map((share) => ({ ...share, userId: toUserId(share.userId) ?? -1 })),
    }));
    if (!isSameImportedExpense(rows, existingGroup?.id ?? null, inUserIds)) {
      changed.push(
        rows.some((row) => row.deletedAt)
          ? `${describeExpense(expense)} was deleted in SplitPro after it was imported.`
          : `${describeExpense(expense)} is already in SplitPro with different amounts or people.`,
      );
    }
  });
  if (changed.length) {
    refuse(
      'Some expenses were imported before (by you or someone else in them) and differ from this file, so nothing was imported.',
      ...changed.slice(0, 3),
    );
  }

  // The balances after this import: expenses imported before as they are now, plus new ones.
  const resulting = createLedger();
  inScope
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

  const newExpenses = active.filter((expense) => !storedById.has(String(expense.id)));
  const newParts = newExpenses.flatMap((expense) => converted.get(String(expense.id))!);

  /**
   * The people this import adds to a group, or puts in an expense or a friendship with you, in
   * Splitwise ids. A new group gets everyone in it; an existing one only who new expenses need.
   */
  const touched = new Set<number>(newParts.flatMap((part) => part.shares.map((s) => s.userId)));
  if (isGroup && !existingGroup) {
    item.group.members.forEach((member) => touched.add(member.id));
  }
  if (!isGroup) {
    item.friends.forEach((friend) => touched.add(friend.id));
  }
  touched.delete(me);
  // Like adding someone to a group or an expense in the app, everyone who already has an account
  // must be known to you: a friend, someone you have a balance with, or someone in a group with
  // you, before this import. People without an account get one, as an invite would.
  const existingTouched = [...touched].flatMap((swId) => {
    const spId = toUserId(swId);
    return undefined === spId ? [] : [spId];
  });
  if (existingTouched.length) {
    const known = await getKnownUserIds(userId, existingTouched);
    const unknown = existingTouched.filter((spId) => !known.has(spId));
    if (unknown.length) {
      const names = unknown.map((spId) => name(splitwiseIdOf.get(spId)!)).sort();
      refuse(
        `${joinNames(names)} already ${1 === names.length ? 'uses' : 'use'} SplitPro but ${1 === names.length ? "isn't" : "aren't"} connected to you there yet. Add ${1 === names.length ? 'them' : 'each of them'} as a friend in SplitPro, then import again.`,
      );
    }
  }
  newParts.forEach((part) => addExpense(resulting, part));

  // What Splitwise reports for the same group or friends.
  const expected = createLedger();
  let checkPairs: (key: string) => boolean;
  if (isGroup) {
    // Who owes whom, from the expenses as they are. Groups that simplify debts show fewer
    // payments, but the original debts are what the expenses add up to, pair by pair.
    if (!item.group.original_debts && (active.length || inScope.length)) {
      refuse("Splitwise didn't report who owes whom in this group, so it can't be checked.");
    }
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
    const debts = createLedger();
    (item.group.original_debts ?? []).forEach((debt) => {
      const amount = parseAmount(debt.amount);
      if (null === amount) {
        refuse("The group's debts couldn't be read.");
      }
      addDebt(debts, debt.currency_code, debt.from, debt.to, amount!);
    });
    expected.pairs = debts.pairs;
    checkPairs = () => true;
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
    // Point at what is likely the cause: expenses deleted in Splitwise after they were imported,
    // or expenses in the SplitPro group that this file doesn't have.
    const deletedSince = deleted
      .filter((expense) => storedById.get(String(expense.id))?.some((row) => !row.deletedAt))
      .slice(0, 3)
      .map(
        (expense) => `${describeExpense(expense)} was deleted in Splitwise after it was imported.`,
      );
    const notInFile = inScope.filter((row) => !fileById.has(row.splitwiseExpenseId!)).length;

    refuse(
      "The expenses don't add up to the balances Splitwise reports, so nothing was imported.",
      ...describeDifferences(expected, resulting, differences, name, me),
      ...deletedSince,
      ...(notInFile
        ? [
            `${notInFile} ${1 === notInFile ? 'expense' : 'expenses'} already imported into this SplitPro group ${1 === notInFile ? "isn't" : "aren't"} in your file.`,
          ]
        : []),
    );
  }

  // Check each new expense like a manual add would, before anything is saved.
  const inputsFor = (
    parts: ConvertedPart[],
    ids: Map<number, number>,
    scopeFor: (part: ConvertedPart) => string,
  ) =>
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
        splitwiseScope: scopeFor(part),
        splitwisePart: part.splitwisePart,
      }),
    );
  // Placeholder ids for people without an account yet; only their uniqueness matters here.
  const checkIds = new Map(
    [...userIds].map(([swId, spId]) => [swId, spId ?? -1_000_000 - swId] as const),
  );
  newParts.forEach((part) => {
    try {
      assertValidImportedExpense(isGroup ? 0 : null, inputsFor([part], checkIds, () => '')[0]!);
    } catch (error) {
      refuse(`"${part.name}": ${error instanceof Error ? error.message : 'not valid'}`);
    }
  });

  /** Everyone whose balance the new expenses change: each payer and every non-zero share. */
  const writtenPeople = (parts: ConvertedPart[], ids: (swId: number) => number | undefined) =>
    parts
      .flatMap((part) => [
        part.paidBy,
        ...part.shares.filter((share) => 0 !== share.amount).map((share) => share.userId),
      ])
      .map(ids)
      .filter((id): id is number => undefined !== id);
  const describeBalanceOnly = (spIds: number[]) => {
    const names = spIds
      .map((spId) => {
        const swId = splitwiseIdOf.get(spId);
        return undefined === swId ? 'someone' : name(swId);
      })
      .sort((a, b) => ('you' === a ? -1 : 'you' === b ? 1 : a.localeCompare(b)));
    const you = 'you' === names[0];
    const others = you ? names.slice(1) : names;
    const who = you
      ? others.length
        ? `You and ${joinNames(others)} have`
        : 'You have'
      : `${joinNames(others)} ${1 === others.length ? 'has' : 'have'}`;
    return [
      `${who} balances from an earlier Splitwise import that brought over balances only, without expenses.`,
      "Those balances may already include these expenses, so they can't be imported on top of them. The balances already imported stay as they are.",
    ];
  };

  if (newParts.length) {
    await assertBalancesFit(resulting, newParts, toUserId, existingGroup?.id ?? null);
  }

  // Everything checks out. Accounts, the group and friendships are saved together, once nobody
  // whose balance changes has balance-only data. Each batch below checks and marks the people it
  // writes in its own transaction too, which is what makes it sound.
  await renewLocks();
  const { ids, groupId } = await runBalanceTransaction(async (tx) => {
    const ids = await createMissingUsers(tx, emails, new Map(userIds), people);
    const balanceOnly = await getBalanceOnlyPeople(
      tx,
      writtenPeople(newParts, (swId) => ids.get(swId)),
    );
    if (balanceOnly.length) {
      throw new Refusal(describeBalanceOnly(balanceOnly));
    }
    const groupId = isGroup
      ? await saveGroup(tx, userId, item.group, existingGroup?.id ?? null, ids, newParts, active)
      : null;
    if (!isGroup) {
      await tx.friendship.createMany({
        data: item.friends.flatMap((friend) => [
          { userId, friendId: ids.get(friend.id)! },
          { userId: ids.get(friend.id)!, friendId: userId },
        ]),
        skipDuplicates: true,
      });
    }
    return { ids, groupId };
  });

  const scopeFor = (part: ConvertedPart) =>
    null !== groupId
      ? groupScope(groupId)
      : usersScope(
          fileById.get(part.splitwiseExpenseId)!.users.map((user) => ids.get(user.user_id)!),
        );

  // Parts of one Splitwise expense are always saved together. If saving stops part way, what was
  // saved stays (each batch is complete on its own) and importing again adds only the rest.
  let saved = 0;
  let alreadySaved = 0;
  try {
    for (let start = 0; start < newExpenses.length; start += IMPORT_BATCH_SIZE) {
      await renewLocks();
      const batch = newExpenses.slice(start, start + IMPORT_BATCH_SIZE);
      const result = await saveBatch(
        groupId,
        inputsFor(
          batch.flatMap((e) => converted.get(String(e.id))!),
          ids,
          scopeFor,
        ),
      );
      saved += result.added;
      alreadySaved += result.skipped;
    }
  } catch (stopped) {
    // What smaller transactions of the failed batch committed before it stopped.
    if (stopped instanceof SaveStoppedError) {
      saved += stopped.progress.added;
      alreadySaved += stopped.progress.skipped;
    }
    const error = stopped instanceof SaveStoppedError ? stopped.cause : stopped;
    if (error instanceof BalanceOnlyPeopleError && 0 === saved + alreadySaved) {
      return { status: 'refused', reasons: describeBalanceOnly(error.userIds) };
    }
    if (
      !(error instanceof ImportedExpenseMismatchError || error instanceof BalanceOnlyPeopleError)
    ) {
      console.error('Splitwise import stopped part way', error);
    }
    return {
      status: 'partial',
      imported: saved,
      remaining: newExpenses.length - saved - alreadySaved,
      alreadyImported: active.length - newExpenses.length + alreadySaved,
      reason:
        error instanceof ImportedExpenseMismatchError || error instanceof LostImportLockError
          ? error.message
          : error instanceof BalanceOnlyPeopleError
            ? describeBalanceOnly(error.userIds).join(' ')
            : error instanceof TRPCError && 'CONFLICT' === error.code
              ? BALANCE_CONFLICT_MESSAGE
              : 'Something went wrong while saving.',
    };
  }

  return {
    status: 'imported',
    imported: saved,
    alreadyImported: active.length - newExpenses.length + alreadySaved,
    skippedDeleted: deleted.length,
    groupId,
  };
};

type SaveProgress = { added: number; skipped: number };

/** Saving stopped, after `progress` was committed by earlier transactions of the same batch. */
class SaveStoppedError extends Error {
  constructor(
    readonly cause: unknown,
    readonly progress: SaveProgress,
  ) {
    super('Saving stopped part way');
  }
}

const withProgress = (error: unknown, before: SaveProgress): SaveStoppedError => {
  const inner =
    error instanceof SaveStoppedError
      ? error
      : new SaveStoppedError(error, { added: 0, skipped: 0 });
  return new SaveStoppedError(inner.cause, {
    added: before.added + inner.progress.added,
    skipped: before.skipped + inner.progress.skipped,
  });
};

/**
 * Saves a batch in one balance transaction. Returns how many Splitwise expenses it added, and how
 * many it found already saved with the same money (someone imported them in the meantime). If it
 * stops, the error says how much smaller transactions committed first.
 */
const saveBatch = async (
  groupId: number | null,
  inputs: ImportedExpenseInput[],
): Promise<SaveProgress> => {
  try {
    return await runBalanceTransaction(async (tx) => {
      // Checked and marked with the balances themselves, so a balance-only import committed at
      // any point before, by this or an older version of the app, is always seen.
      await claimHistoryPeople(
        tx,
        inputs.flatMap((input) => [
          input.paidBy,
          ...input.participants
            .filter((participant) => 0 !== participant.amount)
            .map((participant) => participant.userId),
        ]),
      );
      const { added, skippedIds } = await insertImportedExpenses(tx, groupId, inputs);
      return {
        added: new Set(added.map((expense) => expense.splitwiseExpenseId)).size,
        skipped: skippedIds.length,
      };
    });
  } catch (error) {
    // Busy balances kept conflicting with other writes. Smaller transactions conflict less, so
    // save each half on its own, keeping the parts of one Splitwise expense together.
    const ids = [...new Set(inputs.map((input) => input.splitwiseExpenseId))];
    if (error instanceof TRPCError && 'CONFLICT' === error.code && 1 < ids.length) {
      const firstHalf = new Set(ids.slice(0, Math.ceil(ids.length / 2)));
      const first = await saveBatch(
        groupId,
        inputs.filter((input) => firstHalf.has(input.splitwiseExpenseId)),
      );
      try {
        const second = await saveBatch(
          groupId,
          inputs.filter((input) => !firstHalf.has(input.splitwiseExpenseId)),
        );
        return { added: first.added + second.added, skipped: first.skipped + second.skipped };
      } catch (secondError) {
        throw withProgress(secondError, first);
      }
    }
    throw error;
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
  tx: Prisma.TransactionClient,
  emails: Map<number, string>,
  userIds: Map<number, number | undefined>,
  people: Map<number, SplitwisePerson>,
) => {
  const missing = [...emails].filter(([swId]) => undefined === userIds.get(swId));
  if (missing.length) {
    await tx.user.createMany({
      data: missing.map(([swId, email]) => ({ email, name: getPersonName(people.get(swId)!) })),
      skipDuplicates: true,
    });
    const created = await tx.user.findMany({
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
  tx: Prisma.TransactionClient,
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
    await tx.groupUser.createMany({
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
    const created = await tx.group.create({
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
      throw new Refusal([
        'This group is being imported by someone else right now. Try again in a minute.',
      ]);
    }
    throw error;
  }
};
