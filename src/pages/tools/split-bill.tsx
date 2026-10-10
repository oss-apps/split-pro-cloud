import { AlertCircle, Plus, Trash2 } from 'lucide-react';
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
  Segmented,
  ShareActions,
  Stepper,
  TextInput,
  ToolPage,
} from '~/components/Tools/ToolUi';
import { cn } from '~/lib/utils';
import { formatMoney } from '~/lib/tools/money';
import { type BillItem, splitByItem, splitEvenly } from '~/lib/tools/splitBill';
import { newId, useShareableState } from '~/lib/tools/useShareableState';

const PATH = '/tools/split-bill';
const DESCRIPTION =
  'Split a restaurant bill evenly or by what each person ordered. Tax and tip are shared fairly, and the shares always add up to the total.';

const StateSchema = z.object({
  mode: z.enum(['even', 'items']),
  currency: z.string().min(3).max(3),
  amount: z.string().max(20),
  headcount: z.number().int().min(1).max(50),
  people: z
    .array(z.object({ id: z.string().max(24), name: z.string().max(40) }))
    .min(1)
    .max(20),
  items: z
    .array(
      z.object({
        id: z.string().max(24),
        name: z.string().max(60),
        price: z.string().max(20),
        sharedBy: z.array(z.string().max(24)).max(20),
      }),
    )
    .max(60),
  taxPercent: z.string().max(8),
  tipPercent: z.string().max(8),
  tipOnPreTax: z.boolean(),
});

type State = z.infer<typeof StateSchema>;

const EXAMPLE: State = {
  mode: 'even',
  currency: 'USD',
  amount: '186.50',
  headcount: 4,
  people: [
    { id: 'p1', name: 'Maya' },
    { id: 'p2', name: 'Leo' },
    { id: 'p3', name: 'Nina' },
  ],
  items: [
    { id: 'i1', name: 'Margherita pizza', price: '18', sharedBy: ['p1'] },
    { id: 'i2', name: 'Burrata', price: '14', sharedBy: [] },
    { id: 'i3', name: 'Steak frites', price: '32', sharedBy: ['p2'] },
    { id: 'i4', name: '2 × Aperol spritz', price: '22', sharedBy: ['p1', 'p3'] },
    { id: 'i5', name: 'Tiramisu', price: '9', sharedBy: ['p2', 'p3'] },
  ],
  taxPercent: '8',
  tipPercent: '18',
  tipOnPreTax: true,
};

const EMPTY: State = {
  ...EXAMPLE,
  amount: '',
  headcount: 2,
  people: [
    { id: 'p1', name: 'Person 1' },
    { id: 'p2', name: 'Person 2' },
  ],
  items: [],
  taxPercent: '',
  tipPercent: '',
};

const TIP_PRESETS = ['0', '10', '15', '18', '20'] as const;

const FAQS = [
  {
    question: 'Should the tip be calculated before or after tax?',
    answer:
      'Most etiquette guides suggest tipping on the amount before tax, because tax is not part of the service. It is the default here. Turn it off if you prefer to tip on the full total.',
  },
  {
    question: 'How is tax and tip shared when splitting by item?',
    answer:
      'In proportion to what each person ordered. If your food was 40% of the bill, you pay 40% of the tax and 40% of the tip.',
  },
  {
    question: 'What happens to dishes nobody is assigned to?',
    answer:
      'They are shared equally by everyone at the table, which is usually right for starters and sides. Tap names under a dish to change who shares it.',
  },
  {
    question: 'Why do some people pay one cent more?',
    answer:
      'When a total does not divide evenly, the leftover cents go to the first people in the list, so the shares add up to exactly the bill.',
  },
] as const;

const SplitBillPage = () => {
  const { state, setState, shareUrl, reset } = useShareableState(StateSchema, () => EXAMPLE);
  const { mode, currency } = state;
  const charges = {
    taxPercent: state.taxPercent,
    tipPercent: state.tipPercent,
    tipOnPreTax: state.tipOnPreTax,
  };

  const even = useMemo(
    () => splitEvenly(state.amount, state.headcount, charges, currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.amount,
      state.headcount,
      state.taxPercent,
      state.tipPercent,
      state.tipOnPreTax,
      currency,
    ],
  );
  const itemized = useMemo(
    () => splitByItem(state.people, state.items, charges, currency),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.people, state.items, state.taxPercent, state.tipPercent, state.tipOnPreTax, currency],
  );

  const totals = 'even' === mode ? even : itemized;
  const money = (amount: number) => formatMoney(amount, currency);
  const nameOf = (id: string) => state.people.find((p) => p.id === id)?.name.trim() || 'Someone';

  const updateItem = (id: string, patch: Partial<BillItem>) =>
    setState((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const summary = () => {
    const lines =
      'even' === mode
        ? [`${state.headcount} people · ${money(even.perPerson[0] ?? 0)} each`]
        : itemized.shares.map((share) => `${nameOf(share.id)}: ${money(share.total)}`);
    return [
      `Bill total ${money(totals.total)} (tax ${money(totals.tax)}, tip ${money(totals.tip)})`,
      '',
      ...lines,
      '',
      `Worked out with https://splitpro.app${PATH}`,
    ].join('\n');
  };

  const isPreset = (TIP_PRESETS as readonly string[]).includes(state.tipPercent);

  return (
    <ToolPage
      path={PATH}
      name="Split the bill"
      title="Split the bill calculator"
      seoTitle="Split the bill calculator with tax and tip | SplitPro"
      description={DESCRIPTION}
      faqs={FAQS}
      guide={<Guide />}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Segmented
                label="How to split"
                value={mode}
                onChange={(value) => setState((s) => ({ ...s, mode: value }))}
                options={[
                  { value: 'even', label: 'Split evenly' },
                  { value: 'items', label: 'By item' },
                ]}
              />
              <div className="sm:w-44">
                <CurrencySelect
                  value={currency}
                  onChange={(value) => setState((s) => ({ ...s, currency: value }))}
                />
              </div>
            </div>

            {'even' === mode ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="bill-amount">Bill before tax and tip</FieldLabel>
                  <AmountInput
                    id="bill-amount"
                    placeholder="0.00"
                    value={state.amount}
                    onChange={(amount) => setState((s) => ({ ...s, amount }))}
                    className="h-12 text-lg"
                  />
                </div>
                <div>
                  <FieldLabel>Number of people</FieldLabel>
                  <Stepper
                    label="people"
                    min={1}
                    max={50}
                    value={state.headcount}
                    onChange={(headcount) => setState((s) => ({ ...s, headcount }))}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div>
                  <FieldLabel>Who is at the table?</FieldLabel>
                  <PeopleEditor
                    people={state.people}
                    min={1}
                    onRename={(id, name) =>
                      setState((s) => ({
                        ...s,
                        people: s.people.map((p) => (p.id === id ? { ...p, name } : p)),
                      }))
                    }
                    onAdd={(name) =>
                      setState((s) => ({ ...s, people: [...s.people, { id: newId(), name }] }))
                    }
                    onRemove={(id) =>
                      setState((s) => ({
                        ...s,
                        people: s.people.filter((p) => p.id !== id),
                        items: s.items.map((i) => ({
                          ...i,
                          sharedBy: i.sharedBy.filter((p) => p !== id),
                        })),
                      }))
                    }
                  />
                </div>
                <div>
                  <FieldLabel>What was ordered?</FieldLabel>
                  <div className="space-y-2">
                    {state.items.length ? null : (
                      <EmptyHint>Add each dish or drink with its price.</EmptyHint>
                    )}
                    {state.items.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-white/[0.06] bg-black/20 p-3"
                      >
                        <div className="flex gap-2">
                          <TextInput
                            aria-label="Item name"
                            placeholder={`Item ${index + 1}`}
                            value={item.name}
                            onChange={(e) => updateItem(item.id, { name: e.target.value })}
                          />
                          <AmountInput
                            aria-label="Item price"
                            placeholder="0.00"
                            value={item.price}
                            onChange={(price) => updateItem(item.id, { price })}
                            className="w-28 shrink-0 text-right"
                          />
                          <button
                            type="button"
                            aria-label="Remove item"
                            onClick={() =>
                              setState((s) => ({
                                ...s,
                                items: s.items.filter((i) => i.id !== item.id),
                              }))
                            }
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-white/5 hover:text-gray-200"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {state.people.map((p) => {
                            const selected = item.sharedBy.includes(p.id);
                            return (
                              <Chip
                                key={p.id}
                                selected={selected}
                                onClick={() =>
                                  updateItem(item.id, {
                                    sharedBy: selected
                                      ? item.sharedBy.filter((id) => id !== p.id)
                                      : [...item.sharedBy, p.id],
                                  })
                                }
                              >
                                {p.name || 'Unnamed'}
                              </Chip>
                            );
                          })}
                          {0 === item.sharedBy.length ? (
                            <span className="text-xs text-gray-500">Shared by everyone</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={state.items.length >= 60}
                      onClick={() =>
                        setState((s) => ({
                          ...s,
                          items: [...s.items, { id: newId(), name: '', price: '', sharedBy: [] }],
                        }))
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-sm text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white"
                    >
                      <Plus className="h-4 w-4" /> Add item
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Tax and tip">
            <div className="grid gap-5 sm:grid-cols-[9rem_1fr]">
              <div>
                <FieldLabel htmlFor="tax">Tax %</FieldLabel>
                <AmountInput
                  id="tax"
                  placeholder="0"
                  value={state.taxPercent}
                  onChange={(taxPercent) => setState((s) => ({ ...s, taxPercent }))}
                />
              </div>
              <div>
                <FieldLabel>Tip</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {TIP_PRESETS.map((tip) => (
                    <button
                      key={tip}
                      type="button"
                      aria-pressed={state.tipPercent === tip}
                      onClick={() => setState((s) => ({ ...s, tipPercent: tip }))}
                      className={cn(
                        'h-10 min-w-[3.5rem] rounded-lg border px-3 text-sm tabular-nums transition-colors',
                        state.tipPercent === tip
                          ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100'
                          : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200',
                      )}
                    >
                      {'0' === tip ? 'None' : `${tip}%`}
                    </button>
                  ))}
                  <AmountInput
                    aria-label="Custom tip percent"
                    placeholder="Custom %"
                    value={isPreset ? '' : state.tipPercent}
                    onChange={(tipPercent) => setState((s) => ({ ...s, tipPercent }))}
                    className={cn('w-28', !isPreset && state.tipPercent && 'border-cyan-400/50')}
                  />
                </div>
              </div>
            </div>
            <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={state.tipOnPreTax}
                onChange={(e) => setState((s) => ({ ...s, tipOnPreTax: e.target.checked }))}
                className="h-4 w-4 accent-cyan-400"
              />
              Tip on the amount before tax
            </label>
          </Panel>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24">
          <Panel className="border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.07] to-gray-900/50">
            {'even' === mode ? (
              <>
                <p className="text-sm text-gray-400">Each person pays</p>
                <p className="mt-1 text-5xl font-semibold tabular-nums tracking-tight text-white">
                  {money(Math.max(...even.perPerson))}
                </p>
                {new Set(even.perPerson).size > 1 ? (
                  <p className="mt-2 text-xs text-gray-500">
                    {even.perPerson.filter((p) => p === Math.max(...even.perPerson)).length} people
                    pay {money(Math.max(...even.perPerson))}, the rest pay{' '}
                    {money(Math.min(...even.perPerson))}, so it adds up to the cent.
                  </p>
                ) : null}
                {even.total && even.roundingExtra > 0 ? (
                  <p className="mt-4 rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3 text-sm text-gray-300">
                    Rather pay a round number? Everyone pays{' '}
                    <span className="font-medium text-white">{money(even.roundedPerPerson)}</span>{' '}
                    and the extra {money(even.roundingExtra)} goes to the tip.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm text-gray-400">Each person pays</p>
                <div className="mt-4 space-y-2">
                  {itemized.shares.map((share, index) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-3"
                    >
                      <PersonAvatar name={nameOf(share.id)} index={index} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {nameOf(share.id)}
                        </p>
                        <p className="text-xs tabular-nums text-gray-500">
                          {money(share.subtotal)} + {money(share.tax + share.tip)} tax and tip
                        </p>
                      </div>
                      <span className="text-lg font-semibold tabular-nums text-emerald-300">
                        {money(share.total)}
                      </span>
                    </div>
                  ))}
                </div>
                {itemized.unassigned ? (
                  <p className="mt-3 flex items-start gap-2 text-xs text-gray-400">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    {itemized.unassigned} {1 === itemized.unassigned ? 'item is' : 'items are'}{' '}
                    shared by everyone because nobody is picked.
                  </p>
                ) : null}
              </>
            )}

            <dl className="mt-6 space-y-2 border-t border-white/[0.06] pt-4 text-sm">
              {[
                ['Subtotal', totals.subtotal],
                [`Tax${state.taxPercent ? ` (${state.taxPercent}%)` : ''}`, totals.tax],
                [`Tip${state.tipPercent ? ` (${state.tipPercent}%)` : ''}`, totals.tip],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-gray-400">
                  <dt>{label}</dt>
                  <dd className="tabular-nums">{money(value as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between pt-1 font-medium text-white">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(totals.total)}</dd>
              </div>
            </dl>

            <div className="mt-6">
              <ShareActions shareUrl={shareUrl} summary={summary} onReset={() => reset(EMPTY)} />
            </div>
          </Panel>
        </div>
      </div>
    </ToolPage>
  );
};

const Guide = () => (
  <>
    <h2>Split evenly or by item?</h2>
    <p>
      <strong>Split evenly</strong> when everyone ate and drank about the same. It is quick, and
      nobody has to read the receipt line by line.
    </p>
    <p>
      <strong>Split by item</strong> when orders were very different: one person had a salad and
      water while another had steak and cocktails. Add each dish, tap who shared it, and the
      calculator spreads tax and tip in proportion to what each person ordered.
    </p>
    <h2>A fair default for tips</h2>
    <p>
      Tipping customs differ by country. In the US, 15–20% before tax is common for table service.
      In much of Europe, rounding up or leaving 5–10% is normal. When in doubt, ask the group before
      the bill arrives, so nobody feels put on the spot.
    </p>
    <p>
      Eating out with the same friends every week? Add the bill to a{' '}
      <Link href="/auth/signin">SplitPro group</Link> instead, and settle up once a month.
    </p>
  </>
);

export default SplitBillPage;
