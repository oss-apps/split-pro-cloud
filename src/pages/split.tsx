import { ArrowRight, Check, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { QUICK_SPLIT_PATH, SITE_URL } from '~/components/Site/constants';
import {
  AmountInput,
  Chip,
  CurrencySelect,
  EmptyHint,
  FieldLabel,
  Panel,
  PeopleEditor,
  PersonAvatar,
  Segmented,
  ShareActions,
  TextInput,
  ToolPage,
} from '~/components/Tools/ToolUi';
import { cn } from '~/lib/utils';
import {
  allocate,
  currencySymbol,
  formatMoney,
  parseAmount,
  toInputAmount,
} from '~/lib/tools/money';
import {
  type Person,
  type SharedExpense,
  computeBalances,
  computeTransfers,
  isExpenseValid,
} from '~/lib/tools/settleUp';
import { newId, useShareableState } from '~/lib/tools/useShareableState';

const STORAGE_KEY = 'splitpro.quick-split';
const MAX_PEOPLE = 20;
const MAX_EXPENSES = 300;

const DESCRIPTION =
  'Split costs for a trip, a dinner or a weekend away without signing up. Add who paid for what, see who owes whom in as few payments as possible, and share it all with one link.';

const id = z.string().min(1).max(12);

const StateSchema = z.object({
  v: z.literal(1),
  name: z.string().max(60),
  currency: z.string().length(3),
  people: z
    .array(z.object({ id, name: z.string().max(40) }))
    .min(2)
    .max(MAX_PEOPLE),
  expenses: z
    .array(
      z.object({
        id,
        title: z.string().max(80),
        amount: z.number().int().min(0).max(1e13),
        paidBy: id,
        splitAmong: z.array(id).max(MAX_PEOPLE),
        exact: z.array(z.number().int().min(0).max(1e13)).max(MAX_PEOPLE).optional(),
        payment: z.boolean().optional(),
      }),
    )
    .max(MAX_EXPENSES),
});

type State = z.infer<typeof StateSchema>;

const EXAMPLE: State = {
  v: 1,
  name: 'Cabin weekend',
  currency: 'USD',
  people: [
    { id: 'a', name: 'Alex' },
    { id: 'b', name: 'Priya' },
    { id: 'c', name: 'Jordan' },
    { id: 'd', name: 'Sam' },
  ],
  expenses: [
    { id: 'e1', title: 'Cabin', amount: 48000, paidBy: 'a', splitAmong: ['a', 'b', 'c', 'd'] },
    { id: 'e2', title: 'Groceries', amount: 12640, paidBy: 'b', splitAmong: ['a', 'b', 'c', 'd'] },
    { id: 'e3', title: 'Gas', amount: 7200, paidBy: 'c', splitAmong: ['a', 'c', 'd'] },
    {
      id: 'e4',
      title: 'Dinner on Saturday',
      amount: 18600,
      paidBy: 'd',
      splitAmong: ['a', 'b', 'c', 'd'],
    },
  ],
};

const FAQS = [
  {
    question: 'Do my friends need to sign up?',
    answer:
      'No. Nobody needs an account. Share the link in your group chat and everyone can open it, see the balances and add expenses.',
  },
  {
    question: 'Where is my split saved?',
    answer:
      'In the link itself, and in your browser so it is still there next time you open this page. Nothing is stored on our servers: the part of the link after the # sign never leaves your browser.',
  },
  {
    question: 'Someone added an expense. Why don’t I see it?',
    answer:
      'Because the split lives in the link, each change makes a new link. Whoever adds something should share the link again, and everyone uses the newest one. For a group that keeps adding expenses over weeks, a free SplitPro account keeps everyone in sync automatically.',
  },
  {
    question: 'How does it keep the number of payments low?',
    answer:
      'It works out what each person paid minus what they owe, then repeatedly matches whoever owes the most with whoever is owed the most. Every payment settles at least one person, so a group of n people never needs more than n − 1 payments.',
  },
  {
    question: 'How are odd cents handled?',
    answer:
      'Everything is calculated in whole cents. When a bill does not divide evenly, the leftover cents go to the first people in the split, so the shares always add up to exactly what was paid.',
  },
] as const;

const QuickSplitPage = () => {
  const { state, ready, setState, shareUrl, clear } = useShareableState(StateSchema, STORAGE_KEY);

  return (
    <ToolPage
      path={QUICK_SPLIT_PATH}
      name="Quick split"
      title="Split a trip with friends. No sign-up."
      seoTitle="Quick split: split group expenses online without signing up | SplitPro"
      description={DESCRIPTION}
      faqs={FAQS}
      guide={<Guide />}
    >
      {!ready ? (
        <div className="h-[520px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" />
      ) : state ? (
        <GroupView
          state={state}
          setState={setState}
          shareUrl={shareUrl}
          onNew={() => {
            if (
              window.confirm('Start a new split? Anyone with the link can still open this one.')
            ) {
              clear();
            }
          }}
        />
      ) : (
        <Setup onStart={setState} />
      )}
    </ToolPage>
  );
};

const Setup: React.FC<{ onStart: (state: State) => void }> = ({ onStart }) => {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [names, setNames] = useState(['', '', '']);

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const canStart = 2 <= filled.length;

  const start = () => {
    if (!canStart) {
      return;
    }
    onStart({
      v: 1,
      name: name.trim(),
      currency,
      people: filled.map((personName) => ({ id: newId(), name: personName })),
      expenses: [],
    });
  };

  const preview = useMemo(() => {
    const balances = computeBalances(EXAMPLE.people, EXAMPLE.expenses);
    return computeTransfers(balances);
  }, []);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <p className="text-lg font-medium text-white">Start a split</p>
          <p className="mt-1 text-sm text-gray-400">Takes ten seconds. You can add people later.</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div>
              <FieldLabel htmlFor="group-name">What is it for?</FieldLabel>
              <TextInput
                id="group-name"
                placeholder="Lisbon trip"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="group-currency">Currency</FieldLabel>
              <CurrencySelect id="group-currency" value={currency} onChange={setCurrency} />
            </div>
          </div>

          <FieldLabel>Who is splitting?</FieldLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            {names.map((personName, index) => (
              <div key={index} className="relative">
                <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2">
                  <PersonAvatar name={personName || String(index + 1)} index={index} size="sm" />
                </span>
                <TextInput
                  aria-label={`Person ${index + 1}`}
                  placeholder={0 === index ? 'Your name' : `Friend ${index}`}
                  maxLength={40}
                  value={personName}
                  onChange={(e) =>
                    setNames((all) => all.map((n, i) => (i === index ? e.target.value : n)))
                  }
                  className="pl-10"
                />
              </div>
            ))}
            {names.length < MAX_PEOPLE ? (
              <button
                type="button"
                onClick={() => setNames((all) => [...all, ''])}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 text-sm text-gray-400 transition-colors hover:border-cyan-400/40 hover:text-white"
              >
                <UserPlus className="h-4 w-4" /> Add someone
              </button>
            ) : null}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={!canStart}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 text-sm font-semibold text-gray-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start splitting <ArrowRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onStart(EXAMPLE)}
              className="h-11 rounded-full px-4 text-sm text-gray-400 transition-colors hover:text-white"
            >
              or open an example
            </button>
          </div>
          {!canStart ? (
            <p className="mt-3 text-xs text-gray-500">Add at least two names to start.</p>
          ) : null}
        </form>
      </Panel>

      <div aria-hidden className="hidden lg:block">
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-cyan-400/[0.06] to-transparent p-6">
          <p className="text-sm text-gray-500">{EXAMPLE.name}</p>
          <p className="mt-1 text-sm text-gray-400">Who pays whom</p>
          <div className="mt-4 space-y-2">
            {preview.map((t) => (
              <TransferRow
                key={`${t.from}-${t.to}`}
                from={EXAMPLE.people.find((p) => p.id === t.from)?.name ?? ''}
                to={EXAMPLE.people.find((p) => p.id === t.to)?.name ?? ''}
                fromIndex={EXAMPLE.people.findIndex((p) => p.id === t.from)}
                amount={formatMoney(t.amount, EXAMPLE.currency)}
              />
            ))}
          </div>
          <p className="mt-5 text-sm leading-relaxed text-gray-500">
            Four people, four expenses, three payments. Everyone opens the same link to see it.
          </p>
        </div>
      </div>
    </div>
  );
};

const GroupView: React.FC<{
  state: State;
  setState: (update: (previous: State) => State) => void;
  shareUrl: () => Promise<string>;
  onNew: () => void;
}> = ({ state, setState, shareUrl, onNew }) => {
  const { name, currency, people, expenses } = state;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [showPeople, setShowPeople] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  const balances = useMemo(() => computeBalances(people, expenses), [people, expenses]);
  const transfers = useMemo(() => computeTransfers(balances), [balances]);
  const spent = expenses
    .filter((e) => !e.payment && isExpenseValid(e))
    .reduce((acc, e) => acc + e.amount, 0);
  const expenseCount = expenses.filter((e) => !e.payment).length;

  const involved = useMemo(
    () => new Set(expenses.flatMap((e) => [e.paidBy, ...e.splitAmong])),
    [expenses],
  );

  const money = (amount: number) => formatMoney(amount, currency);
  const nameOf = (personId: string) => {
    const name = people.find((p) => p.id === personId)?.name.trim();
    return name ? name : 'Someone';
  };
  const indexOf = (personId: string) => people.findIndex((p) => p.id === personId);
  const editing = expenses.find((e) => e.id === editingId);

  const saveExpense = (expense: SharedExpense) => {
    setState((s) => ({
      ...s,
      expenses: s.expenses.some((e) => e.id === expense.id)
        ? s.expenses.map((e) => (e.id === expense.id ? expense : e))
        : [...s.expenses, expense],
    }));
    setEditingId(null);
    setFormKey((k) => k + 1);
  };

  const removeExpense = (expenseId: string) => {
    setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== expenseId) }));
    if (editingId === expenseId) {
      setEditingId(null);
      setFormKey((k) => k + 1);
    }
  };

  const summary = (url: string) =>
    [
      `${name || 'Our split'}: ${money(spent)} spent`,
      '',
      ...(transfers.length
        ? transfers.map((t) => `${nameOf(t.from)} pays ${nameOf(t.to)} ${money(t.amount)}`)
        : ['Everyone is settled up.']),
      '',
      `Details: ${url}`,
    ].join('\n');

  return (
    <div className="space-y-6">
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <input
              aria-label="Name of this split"
              value={name}
              maxLength={60}
              placeholder="Untitled split"
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
              className="w-full truncate bg-transparent text-2xl font-semibold tracking-tight text-white outline-none placeholder:text-gray-600"
            />
            <button
              type="button"
              onClick={() => setShowPeople((v) => !v)}
              className="mt-2 flex items-center gap-3 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              <span className="flex -space-x-1.5">
                {people.slice(0, 6).map((p, index) => (
                  <span key={p.id} className="rounded-full ring-2 ring-gray-950">
                    <PersonAvatar name={p.name} index={index} size="sm" />
                  </span>
                ))}
              </span>
              {people.length} people · {currency}
              <span className="text-cyan-300">{showPeople ? 'Done' : 'Edit'}</span>
            </button>
          </div>
          <ShareActions
            shareUrl={shareUrl}
            summary={summary}
            title={name || 'Our split on SplitPro'}
          />
        </div>
        {showPeople ? (
          <div className="mt-5 border-t border-white/[0.06] pt-5">
            <PeopleEditor
              people={people}
              locked={involved}
              max={MAX_PEOPLE}
              onRename={(personId, personName) =>
                setState((s) => ({
                  ...s,
                  people: s.people.map((p) => (p.id === personId ? { ...p, name: personName } : p)),
                }))
              }
              onAdd={(personName) =>
                setState((s) => ({
                  ...s,
                  people: [...s.people, { id: newId(), name: personName }],
                }))
              }
              onRemove={(personId) =>
                setState((s) => ({ ...s, people: s.people.filter((p) => p.id !== personId) }))
              }
            />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="sm:w-56">
                {expenses.length ? (
                  <p className="text-xs text-gray-500">
                    The currency is fixed once there are expenses.
                  </p>
                ) : (
                  <CurrencySelect
                    value={currency}
                    onChange={(value) => setState((s) => ({ ...s, currency: value }))}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={onNew}
                className="self-start text-sm text-gray-500 transition-colors hover:text-gray-200"
              >
                Start a new split
              </button>
            </div>
          </div>
        ) : null}
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div ref={formRef} className="lg:col-start-1">
          <ExpenseForm
            key={`${editingId ?? 'new'}-${formKey}`}
            people={people}
            currency={currency}
            initial={editing}
            disabled={!editing && expenses.length >= MAX_EXPENSES}
            onSubmit={saveExpense}
            onCancel={
              editing
                ? () => {
                    setEditingId(null);
                    setFormKey((k) => k + 1);
                  }
                : undefined
            }
          />
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Panel className="border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.07] to-gray-900/50">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-gray-400">Total spent</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-white">
                  {money(spent)}
                </p>
              </div>
              <p className="text-right text-sm text-gray-500">
                {expenseCount} {1 === expenseCount ? 'expense' : 'expenses'}
              </p>
            </div>

            <p className="mt-6 text-sm font-medium text-gray-300">
              {transfers.length
                ? `${transfers.length} ${1 === transfers.length ? 'payment settles' : 'payments settle'} everyone`
                : 'Settle up'}
            </p>
            <div className="mt-3 space-y-2">
              {transfers.length ? (
                transfers.map((t) => (
                  <TransferRow
                    key={`${t.from}-${t.to}`}
                    from={nameOf(t.from)}
                    to={nameOf(t.to)}
                    fromIndex={indexOf(t.from)}
                    amount={money(t.amount)}
                    onPaid={() =>
                      setState((s) => ({
                        ...s,
                        expenses: [
                          ...s.expenses,
                          {
                            id: newId(),
                            title: '',
                            amount: t.amount,
                            paidBy: t.from,
                            splitAmong: [t.to],
                            payment: true,
                          },
                        ],
                      }))
                    }
                  />
                ))
              ) : (
                <EmptyHint>
                  {spent ? (
                    <span className="inline-flex items-center gap-2 text-emerald-300">
                      <Check className="h-4 w-4" /> Everyone is settled up
                    </span>
                  ) : (
                    'Add an expense to see who owes whom.'
                  )}
                </EmptyHint>
              )}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-gray-500">
              The link holds the whole split. After anyone adds something, they share the link again
              and everyone uses the newest one.
            </p>
          </Panel>

          <Panel title="Balances">
            <div className="text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-white/[0.06] pb-2 text-xs text-gray-500">
                <span>Person</span>
                <span className="w-20 text-right">Spent</span>
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

        <Panel
          className="lg:col-start-1"
          title={
            <>
              Activity{' '}
              <span className="ml-1 text-sm font-normal text-gray-500">{expenses.length}</span>
            </>
          }
        >
          {expenses.length ? (
            <ul className="-mx-2 divide-y divide-white/[0.05]">
              {[...expenses].reverse().map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  money={money}
                  nameOf={nameOf}
                  indexOf={indexOf}
                  active={expense.id === editingId}
                  onEdit={
                    expense.payment
                      ? undefined
                      : () => {
                          setEditingId(expense.id);
                          formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                  }
                  onRemove={() => removeExpense(expense.id)}
                />
              ))}
            </ul>
          ) : (
            <EmptyHint>Expenses and payments show up here.</EmptyHint>
          )}
        </Panel>
      </div>
    </div>
  );
};

const TransferRow: React.FC<{
  from: string;
  to: string;
  fromIndex: number;
  amount: string;
  onPaid?: () => void;
}> = ({ from, to, fromIndex, amount, onPaid }) => (
  <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
    <PersonAvatar name={from} index={fromIndex} />
    <div className="min-w-0 flex-1 text-sm">
      <p className="truncate text-white">
        <span className="font-medium">{from}</span>
        <span className="text-gray-500"> pays </span>
        <span className="font-medium">{to}</span>
      </p>
      <p className="font-semibold tabular-nums text-emerald-300">{amount}</p>
    </div>
    {onPaid ? (
      <button
        type="button"
        onClick={onPaid}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-3 text-xs text-gray-300 transition-colors hover:border-emerald-400/40 hover:text-emerald-200"
      >
        <Check className="h-3.5 w-3.5" /> Mark paid
      </button>
    ) : (
      <ArrowRight className="h-4 w-4 shrink-0 text-gray-600" />
    )}
  </div>
);

const ExpenseRow: React.FC<{
  expense: SharedExpense;
  money: (amount: number) => string;
  nameOf: (id: string) => string;
  indexOf: (id: string) => number;
  active: boolean;
  onEdit?: () => void;
  onRemove: () => void;
}> = ({ expense, money, nameOf, indexOf, active, onEdit, onRemove }) => {
  const payer = nameOf(expense.paidBy);
  const detail = expense.payment
    ? 'Payment'
    : expense.exact
      ? `${payer} paid · exact amounts`
      : expense.splitAmong.length === 1
        ? `${payer} paid · for ${nameOf(expense.splitAmong[0] ?? '')}`
        : `${payer} paid · split ${expense.splitAmong.length} ways`;

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors',
        active && 'bg-cyan-400/[0.06]',
      )}
    >
      {expense.payment ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/30">
          <Check className="h-4 w-4" />
        </span>
      ) : (
        <PersonAvatar name={payer} index={indexOf(expense.paidBy)} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {expense.payment
            ? `${payer} paid ${nameOf(expense.splitAmong[0] ?? '')}`
            : expense.title.trim() || 'Untitled expense'}
        </p>
        <p className="truncate text-xs text-gray-500">{detail}</p>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-medium tabular-nums',
          expense.payment ? 'text-emerald-300' : 'text-gray-100',
        )}
      >
        {money(expense.amount)}
      </span>
      <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
        {onEdit ? (
          <IconButton label="Edit" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        <IconButton label={expense.payment ? 'Undo payment' : 'Delete'} onClick={onRemove}>
          {expense.payment ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </IconButton>
      </div>
    </li>
  );
};

const IconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({
  label,
  onClick,
  children,
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="rounded-full p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200"
  >
    {children}
  </button>
);

type SplitMode = 'equal' | 'exact';

const ExpenseForm: React.FC<{
  people: readonly Person[];
  currency: string;
  initial?: SharedExpense;
  disabled: boolean;
  onSubmit: (expense: SharedExpense) => void;
  onCancel?: () => void;
}> = ({ people, currency, initial, disabled, onSubmit, onCancel }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [amountInput, setAmountInput] = useState(toInputAmount(initial?.amount ?? 0, currency));
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? people[0]?.id ?? '');
  const [splitAmong, setSplitAmong] = useState<string[]>(
    initial?.splitAmong ?? people.map((p) => p.id),
  );
  const [mode, setMode] = useState<SplitMode>(initial?.exact ? 'exact' : 'equal');
  const [exactInputs, setExactInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initial?.splitAmong ?? []).map((personId, index) => [
        personId,
        toInputAmount(initial?.exact?.[index] ?? 0, currency),
      ]),
    ),
  );
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initial) {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [initial]);

  const amount = parseAmount(amountInput, currency);
  const money = (value: number) => formatMoney(value, currency);
  const selected = people.filter((p) => splitAmong.includes(p.id)).map((p) => p.id);
  const exact = selected.map((personId) => parseAmount(exactInputs[personId] ?? '', currency));
  const assigned = exact.reduce((acc, part) => acc + part, 0);
  const equalParts = allocate(
    amount,
    selected.map(() => 1),
  );

  const expense: SharedExpense = {
    id: initial?.id ?? newId(),
    title: title.trim(),
    amount: 'exact' === mode ? assigned : amount,
    paidBy,
    splitAmong: selected,
    ...('exact' === mode ? { exact } : {}),
  };
  const valid = !disabled && isExpenseValid(expense) && people.some((p) => p.id === paidBy);

  const toggle = (personId: string) =>
    setSplitAmong((all) =>
      all.includes(personId) ? all.filter((p) => p !== personId) : [...all, personId],
    );

  return (
    <Panel
      title={initial ? 'Edit expense' : 'Add an expense'}
      className={cn(initial && 'border-cyan-400/30')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            onSubmit(expense);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div>
            <FieldLabel htmlFor="expense-title">What was it?</FieldLabel>
            <input
              ref={titleRef}
              id="expense-title"
              placeholder="Dinner, tickets, groceries…"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            />
          </div>
          {'equal' === mode ? (
            <div>
              <FieldLabel htmlFor="expense-amount">Amount</FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                  {currencySymbol(currency)}
                </span>
                <AmountInput
                  id="expense-amount"
                  placeholder="0.00"
                  value={amountInput}
                  onChange={setAmountInput}
                  className="h-11 pl-9 text-base font-medium"
                />
              </div>
            </div>
          ) : (
            <div>
              <FieldLabel>Amount</FieldLabel>
              <p className="flex h-11 items-center rounded-lg border border-white/[0.06] bg-black/10 px-3 text-base font-medium tabular-nums text-gray-300">
                {money(assigned)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5">
          <FieldLabel>Paid by</FieldLabel>
          <div role="radiogroup" aria-label="Paid by" className="flex flex-wrap gap-1.5">
            {people.map((p, index) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={paidBy === p.id}
                onClick={() => setPaidBy(p.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors',
                  paidBy === p.id
                    ? 'border-cyan-400/50 bg-cyan-400/10 text-white'
                    : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200',
                )}
              >
                <PersonAvatar name={p.name} index={index} size="sm" />
                {p.name.trim() || 'Unnamed'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-400">Split between</span>
            <Segmented
              label="How to split"
              value={mode}
              onChange={(next) => {
                if ('exact' === next && 0 === assigned && amount && selected.length) {
                  setExactInputs(
                    Object.fromEntries(
                      selected.map((personId, index) => [
                        personId,
                        toInputAmount(equalParts[index] ?? 0, currency),
                      ]),
                    ),
                  );
                }
                if ('equal' === next && assigned) {
                  setAmountInput(toInputAmount(assigned, currency));
                }
                setMode(next);
              }}
              options={[
                { value: 'equal', label: 'Equally' },
                { value: 'exact', label: 'Exact amounts' },
              ]}
              size="sm"
            />
          </div>

          {'equal' === mode ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <Chip
                    key={p.id}
                    selected={splitAmong.includes(p.id)}
                    onClick={() => toggle(p.id)}
                  >
                    {splitAmong.includes(p.id) ? <Check className="h-3 w-3" /> : null}
                    {p.name.trim() || 'Unnamed'}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                {selected.length
                  ? amount
                    ? `${money(equalParts[0] ?? 0)} each for ${selected.length} ${1 === selected.length ? 'person' : 'people'}`
                    : `Split between ${selected.length} ${1 === selected.length ? 'person' : 'people'}`
                  : 'Pick at least one person.'}
              </p>
            </>
          ) : (
            <div className="space-y-2">
              {people.map((p, index) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-200">
                    <PersonAvatar name={p.name} index={index} size="sm" />
                    <span className="truncate">{p.name.trim() || 'Unnamed'}</span>
                  </span>
                  <div className="relative w-32">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                      {currencySymbol(currency)}
                    </span>
                    <AmountInput
                      aria-label={`${p.name} owes`}
                      placeholder="0"
                      value={exactInputs[p.id] ?? ''}
                      onChange={(value) => {
                        setExactInputs((all) => ({ ...all, [p.id]: value }));
                        setSplitAmong((all) =>
                          parseAmount(value, currency)
                            ? all.includes(p.id)
                              ? all
                              : [...all, p.id]
                            : all.filter((x) => x !== p.id),
                        );
                      }}
                      className="pl-8 text-right"
                    />
                  </div>
                </div>
              ))}
              <p className="pt-1 text-right text-xs text-gray-500">Total {money(assigned)}</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            disabled={!valid}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 text-sm font-semibold text-gray-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            {initial ? (
              <>
                <Check className="h-4 w-4" /> Save changes
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> Add expense
              </>
            )}
          </button>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-11 rounded-full px-4 text-sm text-gray-400 transition-colors hover:text-white"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
};

const Guide = () => (
  <>
    <h2>How to split a trip without an app</h2>
    <ol>
      <li>
        <strong>Start a split</strong> and add everyone’s name. Nobody needs an account.
      </li>
      <li>
        <strong>Add each expense</strong> as it happens: what it was, how much, and who paid. It is
        split equally by default. Untick anyone who wasn’t part of it, or switch to exact amounts.
      </li>
      <li>
        <strong>Share the link</strong> in your group chat. Everyone sees the same balances and can
        add their own expenses.
      </li>
      <li>
        <strong>Settle up</strong> with the payments on the right, and tap “Mark paid” as people pay
        each other back.
      </li>
    </ol>
    <h2>Why there are fewer payments than receipts</h2>
    <p>
      If Priya paid for groceries and Sam paid for dinner, you might expect everyone to pay each of
      them back. That works, but it creates a lot of small transfers. Quick split nets everything
      first, so someone who paid a little and owes a little might not need to pay anyone at all.
    </p>
    <p>
      We explain the idea step by step in{' '}
      <Link href="/blog/simplify-debts-explained">how “simplify debts” works</Link>, and share
      habits that keep group trips calm in{' '}
      <Link href="/blog/how-to-split-trip-expenses">how to split trip expenses</Link>.
    </p>
    <p>
      Splitting with the same people every month? A{' '}
      <Link href={`${SITE_URL}/auth/signin`}>free SplitPro account</Link> keeps a running tab for
      the group and keeps everyone in sync.
    </p>
  </>
);

export default QuickSplitPage;
