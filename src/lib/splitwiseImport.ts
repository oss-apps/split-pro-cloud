import { z } from 'zod';

import { CURRENCIES } from '~/lib/currency';
import { MAX_AMOUNT_CENTS } from '~/utils/numbers';

/**
 * Reads files from the Splitwise exporter (https://export-splitwise.vercel.app, version 2) and
 * converts Splitwise expenses into SplitPro expenses. Shared by the import page, which splits the
 * file into one request per group or set of friends, and the server, which checks everything again.
 *
 * Shapes follow Splitwise's API: https://github.com/splitwise/api-docs/blob/main/splitwise.yaml
 */

export const MAX_EXPENSES_PER_REQUEST = 20_000;
/** About 0.7 KB per expense, so the largest group allowed fits with room to spare. */
export const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;
const TOO_LARGE = `This has more than ${MAX_EXPENSES_PER_REQUEST.toLocaleString('en-US')} expenses, more than SplitPro can import at once.`;
export const MAX_USERS_PER_EXPENSE = 100;
export const MAX_GROUP_MEMBERS = 300;
export const MAX_PEOPLE = 2_000;

const splitwiseId = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimalString = z.string().max(32);
const currencyCode = z.string().max(10);
const balancesSchema = z
  .array(z.object({ currency_code: currencyCode, amount: decimalString }))
  .max(500);

export const splitwisePersonSchema = z.object({
  id: splitwiseId,
  first_name: z.string().max(200).nullish(),
  last_name: z.string().max(200).nullish(),
  email: z.string().max(320).nullish(),
});

const debtsSchema = z
  .array(
    z.object({
      from: splitwiseId,
      to: splitwiseId,
      amount: decimalString,
      currency_code: currencyCode,
    }),
  )
  .max(50_000);

export const splitwiseGroupSchema = z.object({
  id: splitwiseId,
  name: z.string().max(500),
  members: z
    .array(splitwisePersonSchema.extend({ balance: balancesSchema.nullish() }))
    .max(MAX_GROUP_MEMBERS),
  /** Who owes whom, from the expenses as they are. */
  original_debts: debtsSchema.nullish(),
  /** When on, Splitwise shows `simplified_debts` instead: fewer payments, same totals. */
  simplify_by_default: z.boolean().nullish(),
  simplified_debts: debtsSchema.nullish(),
});

export const splitwiseFriendSchema = splitwisePersonSchema.extend({
  registration_status: z.string().max(50).nullish(),
  /** The balance with this friend over everything: their groups and outside groups. */
  balance: balancesSchema,
  /** The balance with this friend in each group. Group 0, if present, is outside groups. */
  groups: z
    .array(z.object({ group_id: splitwiseId, balance: balancesSchema }))
    .max(5_000)
    .nullish(),
});

export const splitwiseExpenseSchema = z.object({
  id: splitwiseId,
  group_id: splitwiseId.nullish(),
  description: z.string().max(1_000).nullish(),
  payment: z.boolean().nullish(),
  cost: decimalString,
  currency_code: currencyCode,
  date: z.string().max(64),
  deleted_at: z.string().max(64).nullish(),
  category: z.object({ name: z.string().max(200).nullish() }).nullish(),
  users: z
    .array(
      z.object({
        user_id: splitwiseId,
        paid_share: decimalString,
        owed_share: decimalString,
        net_balance: decimalString.nullish(),
      }),
    )
    .max(MAX_USERS_PER_EXPENSE),
  /** Who owes whom in this expense, as Splitwise splits it. */
  repayments: z
    .array(z.object({ from: splitwiseId, to: splitwiseId, amount: decimalString }))
    .max(MAX_USERS_PER_EXPENSE * MAX_USERS_PER_EXPENSE)
    .nullish(),
});

export type SplitwisePerson = z.infer<typeof splitwisePersonSchema>;
export type SplitwiseExportGroup = z.infer<typeof splitwiseGroupSchema>;
export type SplitwiseFriend = z.infer<typeof splitwiseFriendSchema>;
export type SplitwiseExpense = z.infer<typeof splitwiseExpenseSchema>;

const hasDuplicateIds = (ids: unknown[]) => {
  const seen = new Set<unknown>();
  return ids.some((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
};

const DUPLICATE_IDS = 'The file lists the same Splitwise expense more than once.';

/** One group, or friends linked by expenses outside groups, imported in one request. */
export const importItemRequestSchema = z.object({
  version: z.literal(2),
  currentUser: splitwisePersonSchema,
  /** Everyone else the expenses refer to who isn't a group member, e.g. people who left. */
  people: z.array(splitwisePersonSchema).max(MAX_PEOPLE),
  item: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('group'), group: splitwiseGroupSchema }),
    z.object({
      kind: z.literal('friends'),
      friends: z.array(splitwiseFriendSchema).min(1).max(MAX_PEOPLE),
    }),
  ]),
  expenses: z
    .array(splitwiseExpenseSchema)
    .max(MAX_EXPENSES_PER_REQUEST)
    .refine((expenses) => !hasDuplicateIds(expenses.map((expense) => expense.id)), DUPLICATE_IDS),
});

export type ImportItemRequest = z.infer<typeof importItemRequestSchema>;

export type ImportItemResult =
  | {
      status: 'imported';
      /** Splitwise expenses added now, and already imported before. */
      imported: number;
      alreadyImported: number;
      skippedDeleted: number;
      groupId: number | null;
    }
  | {
      /** Stopped part way. What was saved stays; importing again adds only the rest. */
      status: 'partial';
      imported: number;
      remaining: number;
      alreadyImported: number;
      reason: string;
    }
  | { status: 'refused'; reasons: string[] };

export const isSupportedCurrency = (code: string) =>
  CURRENCIES.some((currency) => currency.code === code);

const DECIMAL = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/;

/**
 * Parses a Splitwise decimal string ("25.0", "4.49", "-5.02") exactly, without floats. SplitPro
 * stores every currency in hundredths of its unit (see `toInteger`), JPY included, so "500.0" yen
 * is 50000 like a manually added 500 yen. Returns null for anything else, or amounts too large.
 */
export const parseAmount = (value: string): number | null => {
  const match = DECIMAL.exec(value.trim());
  if (!match) {
    return null;
  }

  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (MAX_AMOUNT_CENTS < cents) {
    return null;
  }

  return match[1] && cents ? -cents : cents;
};

export const formatAmount = (currency: string, cents: number) =>
  `${currency} ${(Math.abs(cents) / 100).toFixed(2)}`;

// Splitwise's English category names. Names are translated to the user's locale, so others fall
// back to the default.
const CATEGORIES: Record<string, string> = {
  general: 'general',
  games: 'games',
  movies: 'movies',
  music: 'music',
  sports: 'sports',
  'dining out': 'diningOut',
  groceries: 'groceries',
  liquor: 'liquor',
  electronics: 'electronics',
  furniture: 'furniture',
  'household supplies': 'supplies',
  maintenance: 'maintenance',
  mortgage: 'mortgage',
  pets: 'pets',
  rent: 'rent',
  services: 'services',
  childcare: 'childcare',
  clothing: 'clothing',
  education: 'education',
  gifts: 'gifts',
  'medical expenses': 'medical',
  taxes: 'taxes',
  'bus/train': 'travel',
  car: 'car',
  'gas/fuel': 'fuel',
  hotel: 'travel',
  parking: 'parking',
  plane: 'plane',
  taxi: 'taxi',
  cleaning: 'cleaning',
  electricity: 'electricity',
  'heat/gas': 'gas',
  trash: 'trash',
  'tv/phone/internet': 'internet',
  water: 'water',
};

export const DEFAULT_CATEGORY = 'general';

export const toCategory = (name: string | null | undefined) =>
  CATEGORIES[(name ?? '').trim().toLowerCase()] ?? DEFAULT_CATEGORY;

export const isDeleted = (expense: Pick<SplitwiseExpense, 'deleted_at'>) => !!expense.deleted_at;

export const isGroupExpense = (expense: Pick<SplitwiseExpense, 'group_id'>) =>
  null !== expense.group_id && undefined !== expense.group_id && 0 !== expense.group_id;

const getName = (description: string | null | undefined) => {
  const name = description?.trim();
  return name ? name : 'Untitled';
};

export const describeExpense = (expense: Pick<SplitwiseExpense, 'description' | 'date'>) =>
  `"${getName(expense.description)}" (${expense.date.slice(0, 10)})`;

/** One SplitPro expense, in Splitwise user ids. Amounts in hundredths. */
export type ConvertedPart = {
  splitwiseExpenseId: string;
  splitwisePart: number;
  name: string;
  category: string;
  currency: string;
  expenseDate: Date;
  isSettlement: boolean;
  amount: number;
  paidBy: number;
  /** What each person is owed (the payer, positive) or owes (negative), adding up to zero. */
  shares: { userId: number; amount: number }[];
};

type Debt = { from: number; to: number; amount: number };

/** Adds up debts per pair, netting opposite directions, so each pair has at most one debt. */
const netDebts = (debts: Debt[]) => {
  const totals = new Map<string, number>();
  debts.forEach(({ from, to, amount }) => {
    const [a, b, sign] = from < to ? [from, to, 1] : [to, from, -1];
    totals.set(`${a}:${b}`, (totals.get(`${a}:${b}`) ?? 0) + sign * amount);
  });
  return [...totals]
    .filter(([, amount]) => 0 !== amount)
    .map(([key, amount]) => {
      const [a, b] = key.split(':').map(Number) as [number, number];
      return 0 < amount ? { from: a, to: b, amount } : { from: b, to: a, amount: -amount };
    })
    .sort((x, y) => x.to - y.to || x.from - y.from);
};

type Share = { id: number; paid: number; owed: number };

/**
 * Who owes whom in one expense, from Splitwise's own data only:
 * - its `repayments`, when they are valid: every amount positive, between two people in the
 *   expense, adding up to each person's net, and each going to someone who paid enough to cover it;
 * - otherwise only when there is a single answer: one person is owed money, or one person owes it.
 * Returns null when several matchings would fit, rather than inventing one between two people.
 */
const getDebts = (users: Share[], repayments: SplitwiseExpense['repayments']): Debt[] | null => {
  const byId = new Map(users.map((user) => [user.id, user]));
  const nets = new Map(users.map((user) => [user.id, user.paid - user.owed]));

  const parsed = (repayments ?? []).map((repayment) => ({
    from: repayment.from,
    to: repayment.to,
    amount: parseAmount(repayment.amount),
  }));
  if (
    parsed.length &&
    parsed.every(
      ({ from, to, amount }) =>
        null !== amount && 0 < amount && from !== to && byId.has(from) && byId.has(to),
    )
  ) {
    const debts = netDebts(parsed as Debt[]);
    const received = new Map<number, number>();
    const balance = new Map<number, number>();
    debts.forEach(({ from, to, amount }) => {
      received.set(to, (received.get(to) ?? 0) + amount);
      balance.set(to, (balance.get(to) ?? 0) + amount);
      balance.set(from, (balance.get(from) ?? 0) - amount);
    });
    const valid =
      users.every((user) => (balance.get(user.id) ?? 0) === nets.get(user.id)) &&
      [...received].every(([id, amount]) => amount <= (byId.get(id)?.paid ?? 0));
    if (valid) {
      return debts;
    }
  }

  const creditors = users.filter((user) => 0 < nets.get(user.id)!);
  const debtors = users.filter((user) => 0 > nets.get(user.id)!);
  if (1 < creditors.length && 1 < debtors.length) {
    return null;
  }
  // With one side a single person, each debt is forced: it's everyone else's net.
  return netDebts(
    1 === creditors.length
      ? debtors.map((debtor) => ({
          from: debtor.id,
          to: creditors[0]!.id,
          amount: -nets.get(debtor.id)!,
        }))
      : creditors.map((creditor) => ({
          from: debtors[0]!.id,
          to: creditor.id,
          amount: nets.get(creditor.id)!,
        })),
  );
};

/**
 * Converts one Splitwise expense. A payment becomes a settle up per pair. Any other expense
 * becomes one expense per person who paid something, for what they paid, so the parts add up to
 * the cost. In payer p's part, everyone who owes p (per `getDebts`) owes that amount and p's own
 * share is the rest. Each person's shares across the parts then add up to what they owe in
 * Splitwise, and each pair owes what Splitwise says. Both are checked before returning.
 */
export const convertExpense = (
  expense: SplitwiseExpense,
): { parts: ConvertedPart[] } | { error: string } => {
  const label = describeExpense(expense);
  const fail = (reason: string) => ({ error: `${label}: ${reason}` });

  if (!isSupportedCurrency(expense.currency_code)) {
    return fail(`SplitPro doesn't support the currency "${expense.currency_code}"`);
  }

  const expenseDate = new Date(expense.date);
  if (Number.isNaN(expenseDate.getTime())) {
    return fail('the date is not valid');
  }

  const cost = parseAmount(expense.cost);
  if (null === cost || 0 > cost) {
    return fail(`the amount "${expense.cost}" is not valid`);
  }

  if (new Set(expense.users.map((user) => user.user_id)).size !== expense.users.length) {
    return fail('someone is listed twice');
  }

  const users = expense.users.map((user) => ({
    id: user.user_id,
    paid: parseAmount(user.paid_share),
    owed: parseAmount(user.owed_share),
    net:
      null === user.net_balance || undefined === user.net_balance
        ? undefined
        : parseAmount(user.net_balance),
  }));

  if (
    users.some(
      (user) =>
        null === user.paid ||
        null === user.owed ||
        null === user.net ||
        0 > user.paid ||
        0 > user.owed ||
        (undefined !== user.net && user.net !== user.paid - user.owed),
    )
  ) {
    return fail('the shares are not valid');
  }

  const valid = (users as Share[]).sort((a, b) => a.id - b.id);
  const totalPaid = valid.reduce((sum, user) => sum + user.paid, 0);
  const totalOwed = valid.reduce((sum, user) => sum + user.owed, 0);
  if (totalPaid !== cost || totalOwed !== cost) {
    return fail("the shares don't add up to the amount");
  }

  const debts = getDebts(valid, expense.repayments);
  if (!debts) {
    return fail(
      "several people paid and several owe, and Splitwise didn't say who owes whom, so it can't be imported exactly",
    );
  }

  const base = {
    splitwiseExpenseId: String(expense.id),
    name: getName(expense.description),
    category: expense.payment ? DEFAULT_CATEGORY : toCategory(expense.category?.name),
    currency: expense.currency_code,
    expenseDate,
  };

  if (expense.payment) {
    // Each payment between two people is a settle up: the payer is owed what they paid.
    return {
      parts: debts.map((debt, index) => ({
        ...base,
        name: 1 < debts.length ? `${base.name} (${index + 1} of ${debts.length})` : base.name,
        splitwisePart: index,
        isSettlement: true,
        amount: debt.amount,
        paidBy: debt.to,
        shares: [
          { userId: debt.to, amount: debt.amount },
          { userId: debt.from, amount: -debt.amount },
        ],
      })),
    };
  }

  const payers = valid.filter((user) => 0 < user.paid);

  // Nothing was paid, so nobody owes anything.
  if (!payers.length) {
    const [first] = valid;
    if (!first) {
      return fail('nobody is part of it');
    }
    return {
      parts: [
        {
          ...base,
          splitwisePart: 0,
          isSettlement: false,
          amount: 0,
          paidBy: first.id,
          shares: valid.map((user) => ({ userId: user.id, amount: 0 })),
        },
      ],
    };
  }

  const involved = new Set([
    ...payers.map((payer) => payer.id),
    ...debts.flatMap((debt) => [debt.from, debt.to]),
  ]);
  // People with no share in any part are kept on the first one, so they still see it.
  const uninvolved = valid.filter((user) => !involved.has(user.id)).map((user) => user.id);

  const parts: ConvertedPart[] = payers.map((payer, index) => {
    const owedToPayer = debts.filter((debt) => debt.to === payer.id);
    return {
      ...base,
      name:
        1 < payers.length
          ? `${base.name} (${index + 1} of ${payers.length}, several payers)`
          : base.name,
      splitwisePart: index,
      isSettlement: false,
      amount: payer.paid,
      paidBy: payer.id,
      shares: [
        { userId: payer.id, amount: owedToPayer.reduce((sum, debt) => sum + debt.amount, 0) },
        ...owedToPayer.map((debt) => ({ userId: debt.from, amount: -debt.amount })),
        ...(0 === index ? uninvolved.map((userId) => ({ userId, amount: 0 })) : []),
      ],
    };
  });

  // Each person's own shares across the parts must be exactly what they owe in Splitwise. The
  // payer of a part owes its amount minus what the others owe them.
  const owedInParts = new Map<number, number>();
  parts.forEach((part) =>
    part.shares.forEach((share) => {
      const owed = share.userId === part.paidBy ? part.amount - share.amount : -share.amount;
      owedInParts.set(share.userId, (owedInParts.get(share.userId) ?? 0) + owed);
    }),
  );
  if (
    parts.some((part) =>
      part.shares.some((share) => share.userId === part.paidBy && share.amount > part.amount),
    ) ||
    valid.some((user) => (owedInParts.get(user.id) ?? 0) !== user.owed)
  ) {
    return fail("the shares can't be split between the people who paid exactly");
  }

  return { parts };
};

/**
 * Balances per pair and per person, in one currency each. A pair is stored once, as what the
 * person with the higher id owes the one with the lower id.
 */
export type Ledger = { pairs: Map<string, number>; nets: Map<string, number> };

export const createLedger = (): Ledger => ({ pairs: new Map(), nets: new Map() });

const add = (map: Map<string, number>, key: string, amount: number) => {
  map.set(key, (map.get(key) ?? 0) + amount);
};

const pairKey = (currency: string, a: number, b: number) =>
  a < b ? `${currency}|${a}|${b}` : `${currency}|${b}|${a}`;

export const addDebt = (
  ledger: Ledger,
  currency: string,
  from: number,
  to: number,
  amount: number,
) => {
  if (0 === amount || from === to) {
    return;
  }
  add(ledger.pairs, pairKey(currency, from, to), to < from ? amount : -amount);
  add(ledger.nets, `${currency}|${to}`, amount);
  add(ledger.nets, `${currency}|${from}`, -amount);
};

export const addExpense = (
  ledger: Ledger,
  expense: { currency: string; paidBy: number; shares: { userId: number; amount: number }[] },
) => {
  expense.shares.forEach((share) => {
    if (share.userId !== expense.paidBy) {
      addDebt(ledger, expense.currency, share.userId, expense.paidBy, -share.amount);
    }
  });
};

/** What `debtor` owes `creditor` in a currency (negative when it's the other way around). */
export const getOwed = (ledger: Ledger, currency: string, debtor: number, creditor: number) => {
  const amount = ledger.pairs.get(pairKey(currency, debtor, creditor)) ?? 0;
  return creditor < debtor ? amount : -amount;
};

export const getNet = (ledger: Ledger, currency: string, userId: number) =>
  ledger.nets.get(`${currency}|${userId}`) ?? 0;

export const parseLedgerKey = (key: string) => {
  const [currency = '', a = '0', b] = key.split('|');
  return { currency, a: Number(a), b: undefined === b ? undefined : Number(b) };
};

/** The balance with a friend outside groups, positive when they owe the current user. */
export const getNonGroupBalances = (
  friend: SplitwiseFriend,
): { currency: string; amount: number }[] | null => {
  const totals = new Map<string, number>();
  const addBalances = (balances: { currency_code: string; amount: string }[], sign: 1 | -1) =>
    balances.every((balance) => {
      const amount = parseAmount(balance.amount);
      if (null === amount) {
        return false;
      }
      add(totals, balance.currency_code, sign * amount);
      return true;
    });

  const nonGroup = friend.groups?.find((group) => 0 === group.group_id);
  const isValid = nonGroup
    ? addBalances(nonGroup.balance, 1)
    : addBalances(friend.balance, 1) &&
      (friend.groups ?? []).every((group) => addBalances(group.balance, -1));

  return isValid ? [...totals].map(([currency, amount]) => ({ currency, amount })) : null;
};

export const getPersonName = (person: Pick<SplitwisePerson, 'first_name' | 'last_name' | 'id'>) =>
  [person.first_name, person.last_name].filter(Boolean).join(' ').trim() ||
  `Splitwise user ${person.id}`;

// The exporter's file. Expenses are checked one by one, so one odd expense refuses only its own
// group or friends instead of the whole file.
export const exportFileSchema = z.object({
  version: z.literal(2),
  currentUser: splitwisePersonSchema,
  friends: z.array(z.unknown()).max(100_000),
  groups: z.array(z.unknown()).max(100_000),
  // The exporter lists each expense once. A file that doesn't was changed, so it's refused whole.
  expenses: z
    .array(z.unknown())
    .max(1_000_000)
    .refine(
      (expenses) =>
        !hasDuplicateIds(
          expenses
            .map((expense) => (expense as { id?: unknown } | null)?.id)
            .filter((id) => undefined !== id && null !== id),
        ),
      DUPLICATE_IDS,
    ),
});

export type PlanItem = {
  key: string;
  label: string;
  /** Splitwise expenses to import (not deleted), and deleted ones, which are skipped. */
  expenseCount: number;
  deletedCount: number;
  /** Why the file alone shows this can't be imported, if it does. */
  problem: string | null;
  /**
   * Splitwise simplifies debts in this group. Everyone's total still matches, but SplitPro shows
   * who owes whom from the expenses as they are, so amounts between two people can differ.
   */
  simplified: boolean;
  request: ImportItemRequest;
};

export type ImportPlan = {
  items: PlanItem[];
  /** Expenses outside groups that don't include the current user, and expenses in groups not in the file. */
  skippedExpenses: number;
  unreadable: number;
};

const parseEach = <T>(schema: z.ZodType<T>, values: unknown[]) => {
  const parsed: T[] = [];
  const invalid: unknown[] = [];
  values.forEach((value) => {
    const result = schema.safeParse(value);
    if (result.success) {
      parsed.push(result.data);
    } else {
      invalid.push(value);
    }
  });
  return { parsed, invalid };
};

const rawGroupId = (value: unknown) => {
  const groupId = (value as { group_id?: unknown } | null)?.group_id;
  return 'number' === typeof groupId ? groupId : null;
};

/**
 * Splits an exported file into what can be imported separately: each group, and friends linked by
 * expenses outside groups (an expense with Ada, Bo and Cy outside a group links Bo and Cy).
 */
export const buildImportPlan = (file: z.infer<typeof exportFileSchema>): ImportPlan => {
  const currentUserId = file.currentUser.id;
  const groups = parseEach(splitwiseGroupSchema, file.groups);
  const friends = parseEach(splitwiseFriendSchema, file.friends);
  const expenses = parseEach(splitwiseExpenseSchema, file.expenses);
  const friendsById = new Map(friends.parsed.map((friend) => [friend.id, friend]));
  const groupIds = new Set(groups.parsed.map((group) => group.id));
  const unreadableGroups = new Set(expenses.invalid.map(rawGroupId));

  let skippedExpenses = 0;
  const items: PlanItem[] = [];
  const count = (list: SplitwiseExpense[]) => ({
    expenseCount: list.filter((expense) => !isDeleted(expense)).length,
    deletedCount: list.filter(isDeleted).length,
  });

  const getPeople = (list: SplitwiseExpense[], known: Set<number>) =>
    [...new Set(list.flatMap((expense) => expense.users.map((user) => user.user_id)))]
      .filter((id) => !known.has(id))
      .map((id) => friendsById.get(id))
      .filter((friend): friend is SplitwiseFriend => !!friend)
      .map(({ id, first_name, last_name, email }) => ({ id, first_name, last_name, email }));

  groups.parsed
    .filter((group) => 0 !== group.id)
    .forEach((group) => {
      const groupExpenses = expenses.parsed.filter((expense) => expense.group_id === group.id);
      const memberIds = new Set([currentUserId, ...group.members.map((member) => member.id)]);
      items.push({
        key: `group:${group.id}`,
        label: group.name,
        simplified: true === group.simplify_by_default,
        ...count(groupExpenses),
        problem: unreadableGroups.has(group.id)
          ? "Some of this group's expenses couldn't be read from the file."
          : MAX_EXPENSES_PER_REQUEST < groupExpenses.length
            ? TOO_LARGE
            : null,
        request: {
          version: 2,
          currentUser: file.currentUser,
          people: getPeople(groupExpenses, memberIds),
          item: { kind: 'group', group },
          expenses: groupExpenses,
        },
      });
    });

  skippedExpenses += expenses.parsed.filter(
    (expense) => isGroupExpense(expense) && !groupIds.has(expense.group_id!),
  ).length;

  // Friends linked by expenses outside groups are imported together.
  const nonGroup = expenses.parsed.filter((expense) => !isGroupExpense(expense));
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    const next = parent.get(id);
    if (undefined === next) {
      parent.set(id, id);
      return id;
    }
    if (next === id) {
      return id;
    }
    const root = find(next);
    parent.set(id, root);
    return root;
  };
  const link = (a: number, b: number) => {
    parent.set(find(a), find(b));
  };

  const mine = nonGroup.filter((expense) =>
    expense.users.some((user) => user.user_id === currentUserId),
  );
  skippedExpenses += nonGroup.length - mine.length;

  mine
    .filter((expense) => !isDeleted(expense))
    .forEach((expense) => {
      const others = expense.users.map((user) => user.user_id).filter((id) => id !== currentUserId);
      others.forEach((id) => {
        find(id);
        if (others[0] !== undefined) link(id, others[0]);
      });
    });

  friends.parsed.forEach((friend) => {
    const balances = getNonGroupBalances(friend);
    if (!balances || balances.some((balance) => 0 !== balance.amount)) {
      find(friend.id);
    }
  });

  const components = new Map<number, number[]>();
  [...parent.keys()].forEach((id) => {
    const root = find(id);
    components.set(root, [...(components.get(root) ?? []), id]);
  });

  [...components.values()].forEach((ids) => {
    const members = new Set(ids);
    const componentExpenses = mine.filter((expense) =>
      expense.users.some((user) => members.has(user.user_id)),
    );
    const componentFriends = ids
      .map((id) => friendsById.get(id))
      .filter((friend): friend is SplitwiseFriend => !!friend)
      .sort((a, b) => getPersonName(a).localeCompare(getPersonName(b)));
    const missing = ids.filter((id) => !friendsById.has(id));
    const counts = count(componentExpenses);

    items.push({
      key: `friends:${[...ids].sort((a, b) => a - b).join(',')}`,
      label: componentFriends.map(getPersonName).join(', ') || 'People outside your friends',
      simplified: false,
      ...counts,
      problem: missing.length
        ? `${missing.length} ${1 === missing.length ? 'person' : 'people'} in these expenses ${1 === missing.length ? "isn't" : "aren't"} in your Splitwise friends, so they can't be matched.`
        : 0 === counts.expenseCount
          ? 'Splitwise reports a balance outside groups, but the file has no expenses that explain it.'
          : unreadableGroups.has(null) || unreadableGroups.has(0)
            ? "Some expenses outside groups couldn't be read from the file."
            : MAX_EXPENSES_PER_REQUEST < componentExpenses.length
              ? TOO_LARGE
              : null,
      request: {
        version: 2,
        currentUser: file.currentUser,
        people: [],
        item: { kind: 'friends', friends: componentFriends },
        expenses: componentExpenses,
      },
    });
  });

  return { items, skippedExpenses, unreadable: expenses.invalid.length };
};
