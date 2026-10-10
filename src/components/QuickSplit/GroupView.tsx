import { ArrowRight, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QUICK_SPLIT_PATH } from '~/components/Site/constants';
import {
  AmountInput,
  Chip,
  CommitInput,
  CurrencySelect,
  EmptyHint,
  FieldLabel,
  Panel,
  PeopleEditor,
  PersonAvatar,
  Segmented,
  ShareActions,
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
import type { QuickSplitData } from '~/server/api/routers/quickSplit';
import { api } from '~/utils/api';

export const MAX_PEOPLE = 20;
export const MAX_EXPENSES = 300;

const errorMessage = (error: { message: string; data?: { zodError?: unknown } | null }) =>
  error.data?.zodError ? 'Please check the details and try again.' : error.message;

/**
 * Every change is its own request, and each returns the whole split, so the cache is replaced with
 * the server's version. Any in-flight poll is cancelled first so it can't overwrite a fresh result.
 */
const useQuickSplitActions = (id: string) => {
  const utils = api.useUtils();
  const options = {
    onMutate: () => utils.quickSplit.get.cancel({ id }),
    onSuccess: (data: QuickSplitData) => utils.quickSplit.get.setData({ id }, data),
    onError: (error: { message: string; data?: { zodError?: unknown } | null }) => {
      toast.error(errorMessage(error));
      utils.quickSplit.get.invalidate({ id }).catch(console.error);
    },
  };

  return {
    update: api.quickSplit.update.useMutation(options),
    addPerson: api.quickSplit.addPerson.useMutation(options),
    renamePerson: api.quickSplit.renamePerson.useMutation(options),
    removePerson: api.quickSplit.removePerson.useMutation(options),
    saveExpense: api.quickSplit.saveExpense.useMutation(options),
    recordPayment: api.quickSplit.recordPayment.useMutation(options),
    deleteExpense: api.quickSplit.deleteExpense.useMutation(options),
  };
};

export const GroupView: React.FC<{ split: QuickSplitData }> = ({ split }) => {
  const { id, name, currency, people, expenses } = split;
  const actions = useQuickSplitActions(id);
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
    const personName = people.find((p) => p.id === personId)?.name.trim();
    return personName ? personName : 'Someone';
  };
  const indexOf = (personId: string) => people.findIndex((p) => p.id === personId);
  const editing = expenses.find((e) => e.id === editingId);

  const resetForm = () => {
    setEditingId(null);
    setFormKey((k) => k + 1);
  };

  useEffect(() => {
    if (editingId && !editing) {
      resetForm();
      toast('Someone else deleted the expense you were editing.');
    }
  }, [editingId, editing]);

  const saveExpense = (expense: SharedExpense) =>
    actions.saveExpense.mutate(
      {
        id,
        expenseId: editing?.id,
        title: expense.title,
        amount: expense.amount,
        paidBy: expense.paidBy,
        splitAmong: expense.splitAmong,
        exact: expense.exact,
      },
      { onSuccess: resetForm },
    );

  const removeExpense = (expenseId: string) => {
    if (editingId === expenseId) {
      resetForm();
    }
    actions.deleteExpense.mutate({ id, expenseId });
  };

  const shareUrl = async () => `${window.location.origin}${QUICK_SPLIT_PATH}/${id}`;

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
            <CommitInput
              aria-label="Name of this split"
              value={name}
              maxLength={60}
              placeholder="Untitled split"
              allowEmpty
              onCommit={(next) => actions.update.mutate({ id, name: next })}
              className="w-full truncate bg-transparent text-2xl font-semibold tracking-tight text-white outline-none placeholder:text-gray-600"
            />
            <button
              type="button"
              onClick={() => setShowPeople((v) => !v)}
              className="mt-2 flex items-center gap-3 text-sm text-gray-400 transition-colors hover:text-gray-200"
            >
              <span className="flex -space-x-1.5">
                {people.slice(0, 6).map((p, index) => (
                  <span key={p.id} className="rounded-full ring-2 ring-background">
                    <PersonAvatar name={p.name} index={index} size="sm" />
                  </span>
                ))}
              </span>
              {people.length} people · {currency}
              <span className="text-primary">{showPeople ? 'Done' : 'Edit people'}</span>
            </button>
          </div>
          <ShareActions
            shareUrl={shareUrl}
            summary={summary}
            title={name || 'Our split on SplitPro'}
          />
        </div>
        {showPeople ? (
          <div className="mt-5 border-t border-white/10 pt-5">
            <PeopleEditor
              people={people}
              locked={involved}
              max={MAX_PEOPLE}
              onRename={(personId, personName) =>
                actions.renamePerson.mutate({ id, personId, name: personName })
              }
              onAdd={(personName) => actions.addPerson.mutate({ id, name: personName })}
              onRemove={(personId) => actions.removePerson.mutate({ id, personId })}
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
                    onChange={(value) => actions.update.mutate({ id, currency: value })}
                  />
                )}
              </div>
              <Link
                href={QUICK_SPLIT_PATH}
                className="self-start text-sm text-gray-500 transition-colors hover:text-gray-200"
              >
                Start a new split
              </Link>
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
            saving={actions.saveExpense.isLoading}
            onSubmit={saveExpense}
            onCancel={editing ? resetForm : undefined}
          />
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Panel>
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

            <div className="mt-6 border-t border-white/10 pt-5">
              <h2 className="font-medium text-white">Who pays whom</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                {transfers.length
                  ? `${transfers.length} ${1 === transfers.length ? 'payment settles' : 'payments settle'} everyone`
                  : 'Nothing to pay yet'}
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {transfers.length ? (
                transfers.map((t) => (
                  <TransferRow
                    key={`${t.from}-${t.to}`}
                    from={nameOf(t.from)}
                    to={nameOf(t.to)}
                    fromIndex={indexOf(t.from)}
                    amount={money(t.amount)}
                    busy={actions.recordPayment.isLoading}
                    onPaid={() =>
                      actions.recordPayment.mutate({ id, from: t.from, to: t.to, amount: t.amount })
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
              Everyone with the link sees changes within a few seconds.
            </p>
          </Panel>

          <Panel title="Balances">
            <div className="text-sm">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-white/10 pb-2 text-xs text-gray-500">
                <span>Person</span>
                <span className="w-20 text-right">Spent</span>
                <span className="w-24 text-right">Balance</span>
              </div>
              {balances.map((b, index) => (
                <div
                  key={b.id}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-white/5 py-2.5 last:border-0"
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
            <ul className="-mx-2 divide-y divide-white/5">
              {[...expenses].reverse().map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  money={money}
                  nameOf={nameOf}
                  indexOf={indexOf}
                  active={expense.id === editingId}
                  busy={
                    actions.deleteExpense.isLoading &&
                    actions.deleteExpense.variables?.expenseId === expense.id
                  }
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

export const TransferRow: React.FC<{
  from: string;
  to: string;
  fromIndex: number;
  amount: string;
  busy?: boolean;
  onPaid?: () => void;
}> = ({ from, to, fromIndex, amount, busy, onPaid }) => (
  <div className="flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5">
    <PersonAvatar name={from} index={fromIndex} />
    <div className="min-w-0 flex-1 text-sm">
      <p className="truncate text-white">
        <span className="font-medium">{from}</span>
        <span className="text-gray-500"> pays </span>
        <span className="font-medium">{to}</span>
      </p>
      <p className="font-medium tabular-nums text-white">{amount}</p>
    </div>
    {onPaid ? (
      <button
        type="button"
        onClick={onPaid}
        disabled={busy}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
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
  busy: boolean;
  onEdit?: () => void;
  onRemove: () => void;
}> = ({ expense, money, nameOf, indexOf, active, busy, onEdit, onRemove }) => {
  const payer = nameOf(expense.paidBy);
  const detail = expense.payment
    ? 'Payment'
    : expense.exact
      ? `${payer} paid · exact amounts`
      : 1 === expense.splitAmong.length
        ? `${payer} paid · for ${nameOf(expense.splitAmong[0] ?? '')}`
        : `${payer} paid · split ${expense.splitAmong.length} ways`;
  const title = expense.title.trim();

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-lg px-2 py-3 transition-colors',
        active && 'bg-white/5',
        busy && 'opacity-50',
      )}
    >
      {expense.payment ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-200">
          <Check className="h-4 w-4" />
        </span>
      ) : (
        <PersonAvatar name={payer} index={indexOf(expense.paidBy)} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">
          {expense.payment
            ? `${payer} paid ${nameOf(expense.splitAmong[0] ?? '')}`
            : title
              ? title
              : 'Untitled expense'}
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
          <IconButton label="Edit" onClick={onEdit} disabled={busy}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        ) : null}
        <IconButton
          label={expense.payment ? 'Undo payment' : 'Delete'}
          onClick={onRemove}
          disabled={busy}
        >
          {expense.payment ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </IconButton>
      </div>
    </li>
  );
};

const IconButton: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    disabled={disabled}
    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:pointer-events-none"
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
  saving: boolean;
  onSubmit: (expense: SharedExpense) => void;
  onCancel?: () => void;
}> = ({ people, currency, initial, disabled, saving, onSubmit, onCancel }) => {
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
  const initialId = initial?.id;

  // Keyed on the id: polling replaces the expense object every few seconds.
  useEffect(() => {
    if (initialId) {
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [initialId]);

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
    id: initialId ?? 'new',
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
      className={cn(initial && 'border-primary/50')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !saving) {
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
              className="h-11 w-full rounded-lg border border-white/15 bg-transparent px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-primary"
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
              <p className="flex h-11 items-center rounded-lg border border-white/10 px-3 text-base font-medium tabular-nums text-gray-300">
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
                    ? 'border-primary/60 bg-primary/10 text-white'
                    : 'border-white/15 text-gray-400 hover:text-gray-200',
                )}
              >
                <PersonAvatar name={p.name} index={index} size="sm" />
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-400">Split between</span>
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
                    {p.name}
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
                    <span className="truncate">{p.name}</span>
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
            disabled={!valid || saving}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
          >
            {initial ? (
              <>
                <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" /> {saving ? 'Adding…' : 'Add expense'}
              </>
            )}
          </button>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-11 rounded-lg px-4 text-sm text-gray-400 transition-colors hover:text-white"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
};
