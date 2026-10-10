import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { z } from 'zod';
import {
  AmountInput,
  CurrencySelect,
  FieldLabel,
  Panel,
  PersonAvatar,
  Segmented,
  ShareActions,
  TextInput,
  ToolPage,
} from '~/components/Tools/ToolUi';
import { cn } from '~/lib/utils';
import { formatMoney } from '~/lib/tools/money';
import { type RentMethod, type Roommate, splitRent } from '~/lib/tools/rentSplit';
import { newId, useShareableState } from '~/lib/tools/useShareableState';

const PATH = '/tools/rent-split';
const DESCRIPTION =
  'Split rent fairly between roommates: by the size of each bedroom, by income, or equally. See how each option compares before you agree on one.';

const StateSchema = z.object({
  currency: z.string().min(3).max(3),
  rent: z.string().max(20),
  method: z.enum(['size', 'income', 'equal']),
  sharedPercent: z.number().min(0).max(90),
  unit: z.enum(['sqft', 'm2']),
  roommates: z
    .array(
      z.object({
        id: z.string().max(24),
        name: z.string().max(40),
        roomSize: z.string().max(12),
        income: z.string().max(16),
      }),
    )
    .min(2)
    .max(12),
});

type State = z.infer<typeof StateSchema>;

const EXAMPLE: State = {
  currency: 'USD',
  rent: '3200',
  method: 'size',
  sharedPercent: 30,
  unit: 'sqft',
  roommates: [
    { id: 'p1', name: 'Alex', roomSize: '180', income: '85000' },
    { id: 'p2', name: 'Priya', roomSize: '140', income: '62000' },
    { id: 'p3', name: 'Jordan', roomSize: '110', income: '54000' },
  ],
};

const EMPTY: State = {
  ...EXAMPLE,
  rent: '',
  roommates: [
    { id: 'p1', name: 'Roommate 1', roomSize: '', income: '' },
    { id: 'p2', name: 'Roommate 2', roomSize: '', income: '' },
  ],
};

const METHODS = [
  { value: 'size', label: 'Room size' },
  { value: 'income', label: 'Income' },
  { value: 'equal', label: 'Equal' },
] as const satisfies readonly { value: RentMethod; label: string }[];

const FAQS = [
  {
    question: 'What is the fairest way to split rent?',
    answer:
      'There is no single answer. Splitting by room size is the most common when bedrooms differ, and splitting by income suits couples or friends who earn very different amounts. The fairest split is the one everyone agrees to before moving in.',
  },
  {
    question: 'What does the shared space slider do?',
    answer:
      'Everyone uses the kitchen, living room and bathroom equally, so that part of the rent is split evenly. The rest is split by bedroom size. At 0%, rent follows room size alone. At 50%, half the rent is split evenly.',
  },
  {
    question: 'How do we handle a couple sharing one room?',
    answer:
      'Add the couple as one row with their room size, then split that amount between the two of you. If you want them to pay more for shared space, add them as two rows and give each half the room size.',
  },
  {
    question: 'Should utilities be split the same way?',
    answer:
      'Usually not. Utilities depend on use, not room size, so most households split them equally. Track them as regular shared expenses in SplitPro.',
  },
] as const;

const RentSplitPage = () => {
  const { state, setState, shareUrl, reset } = useShareableState(StateSchema, () => EXAMPLE);
  const { currency, method, roommates } = state;

  const result = useMemo(
    () => splitRent(state.rent, roommates, method, state.sharedPercent, currency),
    [state.rent, roommates, method, state.sharedPercent, currency],
  );
  const money = (amount: number) => formatMoney(amount, currency);
  const unitLabel = 'sqft' === state.unit ? 'sq ft' : 'm²';
  const maxPercent = Math.max(...result.shares.map((s) => s.percent), 1);

  const updateRoommate = (id: string, patch: Partial<Roommate>) =>
    setState((s) => ({
      ...s,
      roommates: s.roommates.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  const summary = () =>
    [
      `Rent ${money(result.rent)} · split by ${METHODS.find((m) => m.value === method)?.label.toLowerCase()}`,
      '',
      ...result.shares.map((share, i) => {
        const name = roommates[i]?.name.trim() || `Roommate ${i + 1}`;
        return `${name}: ${money(share.amount)} (${share.percent.toFixed(1)}%)`;
      }),
      '',
      `Worked out with https://splitpro.app${PATH}`,
    ].join('\n');

  return (
    <ToolPage
      path={PATH}
      name="Rent split calculator"
      title="Rent split calculator"
      seoTitle="Rent split calculator: by room size or income | SplitPro"
      description={DESCRIPTION}
      faqs={FAQS}
      guide={<Guide />}
    >
      <div className="grid items-start gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel>
            <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
              <div>
                <FieldLabel htmlFor="rent">Monthly rent</FieldLabel>
                <AmountInput
                  id="rent"
                  placeholder="0.00"
                  value={state.rent}
                  onChange={(rent) => setState((s) => ({ ...s, rent }))}
                  className="h-12 text-lg"
                />
              </div>
              <div>
                <FieldLabel htmlFor="currency">Currency</FieldLabel>
                <CurrencySelect
                  id="currency"
                  value={currency}
                  onChange={(value) => setState((s) => ({ ...s, currency: value }))}
                />
              </div>
            </div>
            <div className="mt-6">
              <FieldLabel>Split by</FieldLabel>
              <Segmented
                label="Split by"
                value={method}
                onChange={(value) => setState((s) => ({ ...s, method: value }))}
                options={METHODS}
              />
            </div>
            {'size' === method ? (
              <div className="mt-6 rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor="shared" className="text-gray-300">
                    Rent for shared space, split equally
                  </label>
                  <span className="font-medium tabular-nums text-cyan-200">
                    {state.sharedPercent}%
                  </span>
                </div>
                <input
                  id="shared"
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={state.sharedPercent}
                  onChange={(e) =>
                    setState((s) => ({ ...s, sharedPercent: Number(e.target.value) }))
                  }
                  className="mt-3 w-full accent-cyan-400"
                />
                <p className="mt-2 text-xs leading-relaxed text-gray-500">
                  {money(result.sharedPortion)} covers the kitchen, living room and other shared
                  space. The other {money(result.rent - result.sharedPortion)} follows bedroom size.
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Roommates"
            action={
              'size' === method ? (
                <Segmented
                  label="Unit"
                  value={state.unit}
                  onChange={(unit) => setState((s) => ({ ...s, unit }))}
                  options={[
                    { value: 'sqft', label: 'sq ft' },
                    { value: 'm2', label: 'm²' },
                  ]}
                />
              ) : null
            }
          >
            <div className="space-y-2">
              {roommates.map((roommate, index) => (
                <div
                  key={roommate.id}
                  className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 p-2"
                >
                  <PersonAvatar name={roommate.name} index={index} />
                  <TextInput
                    aria-label={`Roommate ${index + 1} name`}
                    value={roommate.name}
                    onChange={(e) => updateRoommate(roommate.id, { name: e.target.value })}
                    className="border-transparent bg-transparent"
                  />
                  {'equal' === method ? null : (
                    <div className="relative w-36 shrink-0">
                      <AmountInput
                        aria-label={
                          'size' === method
                            ? `${roommate.name} room size in ${unitLabel}`
                            : `${roommate.name} income`
                        }
                        placeholder={'size' === method ? 'Room size' : 'Income'}
                        value={'size' === method ? roommate.roomSize : roommate.income}
                        onChange={(value) =>
                          updateRoommate(
                            roommate.id,
                            'size' === method ? { roomSize: value } : { income: value },
                          )
                        }
                        className="pr-12 text-right"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                        {'size' === method ? unitLabel : '/yr'}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${roommate.name}`}
                    disabled={roommates.length <= 2}
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        roommates: s.roommates.filter((r) => r.id !== roommate.id),
                      }))
                    }
                    className="rounded-full p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200 disabled:invisible"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {roommates.length < 12 ? (
                <button
                  type="button"
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      roommates: [
                        ...s.roommates,
                        {
                          id: newId(),
                          name: `Roommate ${s.roommates.length + 1}`,
                          roomSize: '',
                          income: '',
                        },
                      ],
                    }))
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 py-3 text-sm text-gray-300 transition-colors hover:border-cyan-400/40 hover:text-white"
                >
                  <Plus className="h-4 w-4" /> Add roommate
                </button>
              ) : null}
            </div>
          </Panel>
        </div>

        <div className="lg:sticky lg:top-24">
          <Panel className="border-cyan-400/20 bg-gradient-to-b from-cyan-400/[0.07] to-gray-900/50">
            <p className="text-sm text-gray-400">Each month</p>
            <div className="mt-4 space-y-3">
              {result.shares.map((share, index) => {
                const name = roommates[index]?.name.trim() || `Roommate ${index + 1}`;
                return (
                  <div
                    key={share.id}
                    className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <PersonAvatar name={name} index={index} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{name}</p>
                        <p
                          className={cn(
                            'text-xs tabular-nums',
                            0 < share.vsEqual && 'text-orange-300/80',
                            0 > share.vsEqual && 'text-emerald-300/80',
                            0 === share.vsEqual && 'text-gray-500',
                          )}
                        >
                          {0 === share.vsEqual || 'equal' === method
                            ? 'Same as an equal split'
                            : `${money(Math.abs(share.vsEqual))} ${0 < share.vsEqual ? 'more' : 'less'} than equal`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold tabular-nums text-white">
                          {money(share.amount)}
                        </p>
                        <p className="text-xs tabular-nums text-gray-500">
                          {share.percent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-300 transition-[width] duration-300"
                        style={{ width: `${(share.percent / maxPercent) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-between border-t border-white/[0.06] pt-4 text-sm font-medium text-white">
              <span>Total</span>
              <span className="tabular-nums">{money(result.rent)}</span>
            </div>
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
    <h2>Three ways to split rent</h2>
    <p>
      <strong>Equally</strong> is simplest and works when the bedrooms are about the same.
    </p>
    <p>
      <strong>By room size</strong> is the most common when one room is clearly bigger, has its own
      bathroom or a balcony. Part of the rent pays for space everyone shares, so it makes sense to
      split that part evenly and only the rest by bedroom size. That is what the slider controls.
    </p>
    <p>
      <strong>By income</strong> suits couples and close friends who earn very different amounts.
      Everyone pays the same share of what they earn, rather than the same amount.
    </p>
    <h2>Agree before you sign</h2>
    <p>
      Try each option with your real numbers, share the link, and agree as a group before anyone
      picks a room. Our guide on{' '}
      <Link href="/blog/how-to-split-rent-fairly">how to split rent fairly</Link> walks through the
      trade-offs with examples.
    </p>
  </>
);

export default RentSplitPage;
