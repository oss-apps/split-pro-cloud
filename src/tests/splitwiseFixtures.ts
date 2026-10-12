/**
 * Builds exporter files (version 2) in Splitwise's API shapes, for tests and demos, with fake
 * example.com people. Balances are worked out from the expenses the way Splitwise reports them:
 * each member's net per group, `original_debts` from the expenses' repayments, and each friend's
 * balance overall and per group. Amounts are hundredths.
 *
 * Shapes: https://github.com/splitwise/api-docs/blob/main/splitwise.yaml
 */

export type Person = {
  id: number;
  first_name: string;
  last_name: string | null;
  email: string | null;
};

export const person = (id: number, firstName: string, email: string | null): Person => ({
  id,
  first_name: firstName,
  last_name: null,
  email,
});

/** Splitwise writes "25.0", "4.5" and "4.49". */
export const toDecimal = (cents: number) => {
  const sign = 0 > cents ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  if (0 === fraction) return `${sign}${whole}.0`;
  if (0 === fraction % 10) return `${sign}${whole}.${fraction / 10}`;
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
};

export type ExpenseSpec = {
  id: number;
  groupId?: number | null;
  description?: string;
  currency?: string;
  date?: string;
  payment?: boolean;
  deleted?: boolean;
  category?: string;
  /** [user id, paid, owed] in hundredths. */
  users: [number, number, number][];
  /** [from, to, amount]. Worked out for a single payer when left out. */
  repayments?: [number, number, number][];
};

export const expense = (spec: ExpenseSpec) => {
  const cost = spec.users.reduce((sum, [, paid]) => sum + paid, 0);
  const payers = spec.users.filter(([, paid]) => 0 < paid);
  let repayments = spec.repayments;
  if (!repayments) {
    if (1 !== payers.length) {
      throw new Error('Give repayments for an expense with several payers');
    }
    const payer = payers[0]![0];
    repayments = spec.users
      .filter(([id, , owed]) => id !== payer && 0 < owed)
      .map(([id, , owed]) => [id, payer, owed]);
  }

  return {
    id: spec.id,
    group_id: spec.groupId ?? null,
    friendship_id: null,
    expense_bundle_id: null,
    description: spec.description ?? `Expense ${spec.id}`,
    repeats: false,
    repeat_interval: 'never',
    email_reminder: false,
    email_reminder_in_advance: null,
    next_repeat: null,
    details: null,
    comments_count: 0,
    payment: spec.payment ?? false,
    transaction_confirmed: false,
    cost: toDecimal(cost),
    currency_code: spec.currency ?? 'USD',
    repayments: repayments.map(([from, to, amount]) => ({ from, to, amount: toDecimal(amount) })),
    date: spec.date ?? '2024-05-01T12:00:00Z',
    created_at: spec.date ?? '2024-05-01T12:00:00Z',
    created_by: null,
    updated_at: spec.date ?? '2024-05-01T12:00:00Z',
    updated_by: null,
    deleted_at: spec.deleted ? '2024-06-01T12:00:00Z' : null,
    deleted_by: null,
    category: { id: 18, name: spec.category ?? 'General' },
    receipt: { large: null, original: null },
    users: spec.users.map(([id, paid, owed]) => ({
      user: { id, first_name: `User ${id}`, last_name: null, picture: { medium: '' } },
      user_id: id,
      paid_share: toDecimal(paid),
      owed_share: toDecimal(owed),
      net_balance: toDecimal(paid - owed),
    })),
    comments: [],
  };
};

type SplitwiseExpense = ReturnType<typeof expense>;

const parse = (value: string) => Math.round(Number(value) * 100);

/** Who owes whom per pair, from repayments: key "currency|from|to" after netting. */
const sumDebts = (expenses: SplitwiseExpense[]) => {
  const pairs = new Map<string, number>();
  expenses.forEach((e) =>
    e.repayments.forEach(({ from, to, amount }) => {
      const [a, b] = from < to ? [from, to] : [to, from];
      const key = `${e.currency_code}|${a}|${b}`;
      // Positive: b owes a.
      pairs.set(key, (pairs.get(key) ?? 0) + (from === b ? parse(amount) : -parse(amount)));
    }),
  );
  return pairs;
};

const toBalances = (amounts: Map<string, number>) =>
  [...amounts]
    .filter(([, amount]) => 0 !== amount)
    .map(([currency_code, amount]) => ({ currency_code, amount: toDecimal(amount) }));

export type GroupSpec = {
  id: number;
  name: string;
  memberIds: number[];
  /** Splitwise's "simplify group debts": fewer payments, same totals. Friend balances follow. */
  simplify?: boolean;
};

type Debt = { from: number; to: number; amount: string; currency_code: string };

/** Fewest payments for the same totals, the way Splitwise simplifies (largest first). */
const simplifyDebts = (nets: Map<number, Map<string, number>>): Debt[] => {
  const currencies = new Set([...nets.values()].flatMap((balances) => [...balances.keys()]));
  return [...currencies].sort().flatMap((currency) => {
    const people = [...nets].map(([id, balances]) => [id, balances.get(currency) ?? 0]);
    const debts: Debt[] = [];
    for (;;) {
      people.sort((a, b) => b[1]! - a[1]! || a[0]! - b[0]!);
      const creditor = people[0]!;
      const debtor = people[people.length - 1]!;
      const amount = Math.min(creditor[1]!, -debtor[1]!);
      if (0 >= amount) return debts;
      debts.push({
        from: debtor[0]!,
        to: creditor[0]!,
        amount: toDecimal(amount),
        currency_code: currency,
      });
      creditor[1] = creditor[1]! - amount;
      debtor[1] = debtor[1]! + amount;
    }
  });
};

/** What `friendId` owes `meId` per currency in these debts. */
const owedBy = (debts: Debt[], friendId: number, meId: number) => {
  const totals = new Map<string, number>();
  debts.forEach(({ from, to, amount, currency_code }) => {
    if (from === friendId && to === meId)
      totals.set(currency_code, (totals.get(currency_code) ?? 0) + parse(amount));
    if (from === meId && to === friendId)
      totals.set(currency_code, (totals.get(currency_code) ?? 0) - parse(amount));
  });
  return totals;
};

export const buildExport = ({
  me,
  people,
  groups,
  expenses,
  nonGroupEntry = false,
}: {
  me: Person;
  people: Person[];
  groups: GroupSpec[];
  expenses: SplitwiseExpense[];
  /** Also list the balance outside groups as group 0 on each friend. */
  nonGroupEntry?: boolean;
}) => {
  const active = expenses.filter((e) => !e.deleted_at);
  const byId = new Map([me, ...people].map((p) => [p.id, p]));
  const user = (id: number) => ({
    ...byId.get(id)!,
    registration_status: 'confirmed',
    picture: { small: '', medium: '', large: '' },
    custom_picture: false,
  });

  /** What `friendId` owes me per currency in these expenses. */
  const owedToMe = (friendId: number, list: SplitwiseExpense[]) => {
    const totals = new Map<string, number>();
    sumDebts(list).forEach((amount, key) => {
      const [currency, a, b] = key.split('|');
      const [lo, hi] = [Number(a), Number(b)];
      if (lo === me.id && hi === friendId)
        totals.set(currency!, (totals.get(currency!) ?? 0) + amount);
      if (hi === me.id && lo === friendId)
        totals.set(currency!, (totals.get(currency!) ?? 0) - amount);
    });
    return totals;
  };

  const groupObjects = groups.map((group) => {
    const groupExpenses = active.filter((e) => e.group_id === group.id);
    const nets = new Map<number, Map<string, number>>();
    groupExpenses.forEach((e) =>
      e.users.forEach((u) => {
        const balances = nets.get(u.user_id) ?? new Map<string, number>();
        nets.set(u.user_id, balances);
        balances.set(e.currency_code, (balances.get(e.currency_code) ?? 0) + parse(u.net_balance));
      }),
    );
    const debts: Debt[] = [...sumDebts(groupExpenses)]
      .filter(([, amount]) => 0 !== amount)
      .map(([key, amount]) => {
        const [currency = '', a, b] = key.split('|');
        // amount > 0: b owes a.
        return 0 < amount
          ? { from: Number(b), to: Number(a), amount: toDecimal(amount), currency_code: currency }
          : { from: Number(a), to: Number(b), amount: toDecimal(-amount), currency_code: currency };
      });

    const simplified = group.simplify ? simplifyDebts(nets) : debts;

    return {
      id: group.id,
      name: group.name,
      group_type: 'home',
      updated_at: '2024-06-01T12:00:00Z',
      simplify_by_default: !!group.simplify,
      members: group.memberIds.map((id) => ({
        ...user(id),
        balance: toBalances(nets.get(id) ?? new Map<string, number>()),
      })),
      original_debts: debts,
      simplified_debts: simplified,
      avatar: {},
      custom_avatar: false,
      cover_photo: {},
      invite_link: '',
    };
  });

  const friends = people.map((friend) => {
    // Splitwise reports balances in a group as it shows them: simplified, if the group is.
    const groupOwed = groups
      .map((group, index) => ({ group, object: groupObjects[index]! }))
      .filter(({ group }) => group.memberIds.includes(friend.id) && group.memberIds.includes(me.id))
      .map(({ group, object }) => ({
        group_id: group.id,
        owed: owedBy(object.simplified_debts, friend.id, me.id),
      }));
    const nonGroupOwed = owedToMe(
      friend.id,
      active.filter((e) => !e.group_id),
    );
    const overall = new Map(nonGroupOwed);
    groupOwed.forEach(({ owed }) =>
      owed.forEach((amount, currency) =>
        overall.set(currency, (overall.get(currency) ?? 0) + amount),
      ),
    );
    const groupBalances = groupOwed.map(({ group_id, owed }) => ({
      group_id,
      balance: toBalances(owed),
    }));
    const nonGroup = toBalances(nonGroupOwed);
    return {
      ...user(friend.id),
      balance: toBalances(overall),
      groups: nonGroupEntry
        ? [...groupBalances, { group_id: 0, balance: nonGroup }]
        : groupBalances,
      updated_at: '2024-06-01T12:00:00Z',
    };
  });

  return {
    version: 2 as const,
    exportedAt: '2024-06-02T12:00:00.000Z',
    currentUser: { ...user(me.id), default_currency: 'USD', locale: 'en' },
    friends,
    groups: [
      {
        ...groupObjects[0]!,
        id: 0,
        name: 'Non-group expenses',
        members: [{ ...user(me.id), balance: [] as { currency_code: string; amount: string }[] }],
        original_debts: [],
        simplified_debts: [],
      },
      ...groupObjects,
    ],
    expenses,
  };
};
