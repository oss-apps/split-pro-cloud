import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { z } from 'zod';
import {
  AmountInput,
  Chip,
  CurrencySelect,
  EmptyHint,
  FieldLabel,
  Panel,
  PeopleEditor,
  PersonAvatar,
  ShareActions,
  TextInput,
  ToolPage,
} from '~/components/Tools/ToolUi';
import { cn } from '~/lib/utils';
import { formatMoney } from '~/lib/tools/money';
import {
  type SharedExpense,
  computeBalances,
  computeTransfers,
  countDirectPayments,
} from '~/lib/tools/settleUp';
import { newId, useShareableState } from '~/lib/tools/useShareableState';

const PATH = '/tools/settle-up';
const DESCRIPTION =
  'Add who paid for what on a trip, a night out or in a shared home. The calculator works out who owes whom, in as few payments as possible.';

const StateSchema = z.object({
  currency: z.string().min(3).max(3),
  people: z
    .array(z.object({ id: z.string().max(24), name: z.string().max(40) }))
    .min(2)
    .max(20),
  expenses: z
    .array(
      z.object({
        id: z.string().max(24),
        title: z.string().max(60),
        amount: z.string().max(20),
        paidBy: z.string().max(24),
        splitAmong: z.array(z.string().max(24)).max(20),
      }),
    )
    .max(100),
});

type State = z.infer<typeof StateSchema>;

const EXAMPLE: State = {
  currency: 'USD',
  people: [
    { id: 'p1', name: 'Alex' },
    { id: 'p2', name: 'Priya' },
    { id: 'p3', name: 'Jordan' },
    { id: 'p4', name: 'Sam' },
  ],
  expenses: [
    {
      id: 'e1',
      title: 'Cabin for the weekend',
      amount: '480',
      paidBy: 'p1',
      splitAmong: ['p1', 'p2', 'p3', 'p4'],
    },
    {
      id: 'e2',
      title: 'Groceries',
      amount: '126.40',
      paidBy: 'p2',
      splitAmong: ['p1', 'p2', 'p3', 'p4'],
    },
    { id: 'e3', title: 'Gas', amount: '72', paidBy: 'p3', splitAmong: ['p1', 'p3', 'p4'] },
    {
      id: 'e4',
      title: 'Dinner on Saturday',
      amount: '186',
      paidBy: 'p4',
      splitAmong: ['p1', 'p2', 'p3', 'p4'],
    },
  ],
};

const EMPTY: State = {
  currency: 'USD',
  people: [
    { id: 'p1', name: 'Person 1' },
    { id: 'p2', name: 'Person 2' },
  ],
  expenses: [],
};

const FAQS = [
  {
    question: 'How does the calculator keep the number of payments low?',
    answer:
      'It first works out each person’s balance: what they paid minus their share. Then it repeatedly matches the person who owes the most with the person who is owed the most. Every payment settles at least one person, so a group of n people never needs more than n − 1 payments.',
  },
  {
    question: 'What if someone did not take part in an expense?',
    answer:
      'Untick them under “Split between” for that expense. Their share of it becomes zero and the cost is split among the others.',
  },
  {
    question: 'How are odd cents handled?',
    answer:
      'Amounts are calculated in whole cents. When a bill does not divide evenly, the leftover cents go to the first people in the split, so the shares always add up to exactly what was paid.',
  },
  {
    question: 'Is my data stored anywhere?',
    answer:
      'No. Everything is calculated in your browser. When you copy the link, the expenses are packed into the part of the URL after the # sign, which browsers never send to our server.',
  },
] as const;

const SettleUpPage = () => {
  const { state, setState, shareUrl, reset } = useShareableState(StateSchema, () => EXAMPLE);
  const { currency, people, expenses } = state;

  const balances = useMemo(
    () => computeBalances(people, expenses, currency),
    [people, expenses, currency],
  );
  const transfers = useMemo(() => computeTransfers(balances), [balances]);
  const directPayments = useMemo(
    () => countDirectPayments(expenses, currency),
    [expenses, currency],
  );
  const total = balances.reduce((acc, b) => acc + b.paid, 0);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name.trim() || 'Someone';
  const indexOf = (id: string) => people.findIndex((p) => p.id === id);
  const money = (amount: number) => formatMoney(amount, currency);

  const updateExpense = (id: string, patch: Partial<SharedExpense>) =>
    setState((s) => ({
      ...s,
      expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  const summary = () =>
    [
      `Settle up · total ${money(total)}`,
      '',
      ...(transfers.length
        ? transfers.map((t) => `${nameOf(t.from)} pays ${nameOf(t.to)} ${money(t.amount)}`)
        : ['Everyone is settled up.']),
      '',
      `Worked out with https://splitpro.app${PATH}`,
    ].join('\n');

  return (
    <ToolPage
      path={PATH}
      name="Settle-up calculator"
      title="Settle-up calculator"
      seoTitle="Settle-up calculator: who owes whom after a trip | SplitPro"
      description={DESCRIPTION}
      faqs={FAQS}
      guide={<Guide />}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel
            title="People"
            action={
              <div className="w-44">
                <CurrencySelect
                  value={currency}
                  onChange={(value) => setState((s) => ({ ...s, currency: value }))}
                />
              </div>
            }
          >
            <PeopleEditor
              people={people}
              onRename={(id, name) =>
                setState((s) => ({
                  ...s,
                  people: s.people.map((p) => (p.id === id ? { ...p, name } : p)),
                }))
              }
              onAdd={(name) =>
                setState((s) => {
                  const id = newId();
                  return {
                    ...s,
                    people: [...s.people, { id, name }],
                    expenses: s.expenses.map((e) => ({ ...e, splitAmong: [...e.splitAmong, id] })),
                  };
                })
              }
              onRemove={(id) =>
                setState((s) => {
                  const remaining = s.people.filter((p) => p.id !== id);
                  const fallback = remaining[0]?.id ?? '';
                  return {
                    ...s,
                    people: remaining,
                    expenses: s.expenses.map((e) => ({
                      ...e,
                      paidBy: e.paidBy === id ? fallback : e.paidBy,
                      splitAmong: e.splitAmong.filter((p) => p !== id),
                    })),
                  };
                })
              }
            />
          </Panel>

          <Panel
            title={
              <>
                Expenses{' '}
                <span className="ml-1 text-sm font-normal text-gray-500">{expenses.length}</span>
              </>
            }
          >
            <div className="space-y-3">
              {expenses.length ? null : (
                <EmptyHint>Add the first expense: who paid, and how much.</EmptyHint>
              )}
              {expenses.map((expense, index) => (
                <div
                  key={expense.id}
                  className="rounded-xl border border-white/[0.06] bg-black/20 p-4"
                >
                  <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <div>
                      <FieldLabel htmlFor={`title-${expense.id}`}>What was it for?</FieldLabel>
                      <TextInput
                        id={`title-${expense.id}`}
                        placeholder={`Expense ${index + 1}`}
                        value={expense.title}
                        onChange={(e) => updateExpense(expense.id, { title: e.target.value })}
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor={`amount-${expense.id}`}>Amount</FieldLabel>
                      <AmountInput
                        id={`amount-${expense.id}`}
                        placeholder="0.00"
                        value={expense.amount}
                        onChange={(amount) => updateExpense(expense.id, { amount })}
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <div>
                      <FieldLabel htmlFor={`paid-${expense.id}`}>Paid by</FieldLabel>
                      <select
                        id={`paid-${expense.id}`}
                        value={expense.paidBy}
                        onChange={(e) => updateExpense(expense.id, { paidBy: e.target.value })}
                        className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-400/60"
                      >
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name || 'Unnamed'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <FieldLabel>Split between</FieldLabel>
                      <div className="flex min-h-10 flex-wrap items-center gap-1.5">
                        {people.map((p) => {
                          const selected = expense.splitAmong.includes(p.id);
                          return (
                            <Chip
                              key={p.id}
                              selected={selected}
                              onClick={() =>
                                updateExpense(expense.id, {
                                  splitAmong: selected
                                    ? expense.splitAmong.filter((id) => id !== p.id)
                                    : [...expense.splitAmong, p.id],
                                })
                              }
                            >
                              {p.name || 'Unnamed'}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {expense.splitAmong.length
                        ? `Split ${expense.splitAmong.length} ways`
                        : 'Pick at least one person'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          expenses: s.expenses.filter((e) => e.id !== expense.id),
                        }))
                      }
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-white/5 hover:text-gray-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                disabled={expenses.length >= 100}
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    expenses: [
                      ...s.expenses,
                      {
                        id: newId(),
                        title: '',
                        amount: '',
                        paidBy: s.people[0]?.id ?? '',
                        splitAmong: s.people.map((p) => p.id),
                      },
                    ],
                  }))
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-sm text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white"
              >
                <Plus className="h-4 w-4" /> Add expense
              </button>
            </div>
          </Panel>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Panel className="border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.07] to-gray-900/50">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-gray-400">Total spent</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white">
                  {money(total)}
                </p>
              </div>
              {transfers.length ? (
                <p className="text-right text-sm text-gray-400">
                  <span className="font-medium text-cyan-200">
                    {transfers.length} {1 === transfers.length ? 'payment' : 'payments'}
                  </span>
                  {directPayments > transfers.length ? (
                    <>
                      <br />
                      instead of {directPayments}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="mt-6 space-y-2">
              {transfers.length ? (
                transfers.map((t) => (
                  <div
                    key={`${t.from}-${t.to}`}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3"
                  >
                    <PersonAvatar name={nameOf(t.from)} index={indexOf(t.from)} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate text-white">
                        <span className="font-medium">{nameOf(t.from)}</span>
                        <span className="text-gray-500"> pays </span>
                        <span className="font-medium">{nameOf(t.to)}</span>
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-gray-600" />
                    <span className="shrink-0 text-base font-semibold tabular-nums text-emerald-300">
                      {money(t.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <EmptyHint>
                  {total ? 'Everyone is settled up.' : 'Add an expense to see who owes whom.'}
                </EmptyHint>
              )}
            </div>

            <div className="mt-6">
              <ShareActions shareUrl={shareUrl} summary={summary} onReset={() => reset(EMPTY)} />
            </div>
          </Panel>

          <Panel title="Balances">
            <div className="text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-white/[0.06] pb-2 text-xs text-gray-500">
                <span>Person</span>
                <span className="w-20 text-right">Paid</span>
                <span className="w-24 text-right">Balance</span>
              </div>
              {balances.map((b, index) => (
                <div
                  key={b.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-white/[0.04] py-2.5 last:border-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <PersonAvatar name={nameOf(b.id)} index={index} size="sm" />
                    <span className="truncate text-gray-200">{nameOf(b.id)}</span>
                  </span>
                  <span className="w-20 text-right tabular-nums text-gray-400">
                    {money(b.paid)}
                  </span>
                  <span
                    className={cn(
                      'w-24 text-right font-medium tabular-nums',
                      0 < b.net && 'text-emerald-300',
                      0 > b.net && 'text-orange-400',
                      0 === b.net && 'text-gray-500',
                    )}
                  >
                    {0 < b.net ? '+' : ''}
                    {0 > b.net ? '−' : ''}
                    {money(Math.abs(b.net))}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </ToolPage>
  );
};

const Guide = () => (
  <>
    <h2>How to use the settle-up calculator</h2>
    <ol>
      <li>
        <strong>Add everyone</strong> who shared costs. Names stay in your browser.
      </li>
      <li>
        <strong>Add each expense</strong> with the amount and who paid it. By default it is split
        between everyone. Untick anyone who wasn’t part of it.
      </li>
      <li>
        <strong>Read the payments</strong> on the right. Each line is one transfer, and together
        they settle the whole group.
      </li>
      <li>
        <strong>Share the result</strong> with “Copy link”, or paste the text into your group chat.
      </li>
    </ol>
    <h2>Why the payments look different from the receipts</h2>
    <p>
      If Priya paid for groceries and Sam paid for dinner, you might expect everyone to pay each of
      them back. That works, but it creates a lot of small transfers. The calculator nets everything
      first. Someone who paid a little and owes a little might end up paying nothing at all, and the
      person who covered the cabin gets paid back by fewer people.
    </p>
    <p>
      We explain the idea step by step in{' '}
      <Link href="/blog/simplify-debts-explained">how “simplify debts” works</Link>, and share some
      habits that keep group trips calm in{' '}
      <Link href="/blog/how-to-split-trip-expenses">how to split trip expenses</Link>.
    </p>
  </>
);

export default SettleUpPage;
