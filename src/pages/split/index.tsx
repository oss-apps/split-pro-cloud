import { ArrowRight, ChevronRight, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { toast } from 'sonner';
import { MAX_PEOPLE } from '~/components/QuickSplit/GroupView';
import {
  QUICK_SPLIT_DESCRIPTION,
  QUICK_SPLIT_FAQS,
  QuickSplitGuide,
} from '~/components/QuickSplit/content';
import { useRecentSplits } from '~/components/QuickSplit/useRecentSplits';
import { QUICK_SPLIT_PATH } from '~/components/Site/constants';
import {
  CurrencySelect,
  FieldLabel,
  Panel,
  PersonAvatar,
  TextInput,
  ToolPage,
} from '~/components/Tools/ToolUi';
import { api } from '~/utils/api';

const QuickSplitPage = () => (
  <ToolPage
    path={QUICK_SPLIT_PATH}
    name="Quick split"
    title="Split a trip with friends. No sign-up."
    seoTitle="Quick split: split group expenses online without signing up | SplitPro"
    description={QUICK_SPLIT_DESCRIPTION}
    faqs={QUICK_SPLIT_FAQS}
    guide={<QuickSplitGuide />}
  >
    <Setup />
  </ToolPage>
);

const STEPS = [
  {
    title: 'Add the people',
    description: 'Type the names of everyone in the split. Nobody needs an account.',
  },
  {
    title: 'Add expenses as they happen',
    description: 'Who paid, how much, and who it was for.',
  },
  {
    title: 'Share the link',
    description:
      'Everyone sees the same split and who pays whom. The link stays the same as you add more.',
  },
] as const;

const Setup = () => {
  const router = useRouter();
  const { recent, forget } = useRecentSplits();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [names, setNames] = useState(['', '', '']);
  const create = api.quickSplit.create.useMutation({
    onSuccess: ({ id }) => {
      router.push(`${QUICK_SPLIT_PATH}/${id}`).catch(console.error);
    },
    onError: (error) => toast.error(error.message),
  });

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const canStart = 2 <= filled.length && !create.isLoading && !create.isSuccess;

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canStart) {
                create.mutate({ name: name.trim(), currency, people: filled });
              }
            }}
          >
            <p className="text-lg font-medium text-white">Start a split</p>
            <p className="mt-1 text-sm text-gray-400">
              Takes ten seconds. You can add people later.
            </p>

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
                    <PersonAvatar
                      name={personName ? personName : String(index + 1)}
                      index={index}
                      size="sm"
                    />
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
                  className="flex h-10 items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <UserPlus className="h-4 w-4" /> Add someone
                </button>
              ) : null}
            </div>

            <div className="mt-8">
              <button
                type="submit"
                disabled={!canStart}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {create.isLoading || create.isSuccess ? 'Creating…' : 'Start splitting'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            {2 > filled.length ? (
              <p className="mt-3 text-xs text-gray-500">Add at least two names to start.</p>
            ) : null}
          </form>
        </Panel>

        {recent.length ? (
          <Panel title="Your recent splits">
            <ul className="-mx-2 divide-y divide-white/5">
              {recent.map((split) => (
                <li key={split.id} className="group flex items-center gap-2">
                  <Link
                    href={`${QUICK_SPLIT_PATH}/${split.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-3 text-sm text-gray-200 transition-colors hover:bg-white/[0.03] hover:text-white"
                  >
                    <span className="truncate">{split.name ? split.name : 'Untitled split'}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-600" />
                  </Link>
                  <button
                    type="button"
                    aria-label={`Remove ${split.name ? split.name : 'split'} from this list`}
                    title="Remove from this list"
                    onClick={() => forget(split.id)}
                    className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-white/5 hover:text-gray-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-gray-500">
              Only on this device. Removing a split here does not delete it.
            </p>
          </Panel>
        ) : null}
      </div>

      <div>
        <h2 className="font-medium text-white">How it works</h2>
        <ol className="mt-4 space-y-5">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 text-sm text-gray-300">
                {index + 1}
              </span>
              <div>
                <p className="font-medium text-gray-100">{step.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-gray-400">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default QuickSplitPage;
