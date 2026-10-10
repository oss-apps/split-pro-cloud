import { Check, Copy, Plus, Share2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CURRENCIES } from '~/lib/currency';
import { cn } from '~/lib/utils';
import { CtaBand, Faq, type FaqItem } from '../Site/blocks';
import { Seo, faqJsonLd, toolJsonLd } from '../Site/Seo';
import { SiteLayout } from '../Site/SiteLayout';

export const ToolPage: React.FC<{
  path: string;
  name: string;
  title: string;
  seoTitle: string;
  description: string;
  faqs: readonly FaqItem[];
  guide: React.ReactNode;
  children: React.ReactNode;
}> = ({ path, name, title, seoTitle, description, faqs, guide, children }) => (
  <SiteLayout>
    <Seo
      title={seoTitle}
      description={description}
      path={path}
      jsonLd={[toolJsonLd(name, description, path), faqJsonLd(faqs)]}
    />
    <section className="mx-auto max-w-6xl px-5 pt-10 sm:pt-14 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-pretty text-lg leading-relaxed text-gray-400">
          {description}
        </p>
      </div>
      <div className="mt-8">{children}</div>
    </section>
    <section className="mx-auto mt-24 grid max-w-6xl gap-14 px-5 lg:grid-cols-[1.4fr_1fr] lg:px-8">
      <div className="prose prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h2:text-2xl prose-p:leading-relaxed prose-p:text-gray-400 prose-a:text-primary prose-strong:text-gray-100 prose-li:text-gray-400">
        {guide}
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">Common questions</h2>
        <div className="mt-6">
          <Faq items={faqs} />
        </div>
      </div>
    </section>
    <div className="mt-24">
      <CtaBand
        title="Splitting with the same people again?"
        description="SplitPro keeps a running tab for your group, so next time you just add the expense and everyone sees who owes whom."
      />
    </div>
  </SiteLayout>
);

export const Panel: React.FC<{
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ title, action, children, className }) => (
  <div className={cn('rounded-xl border border-white/10 p-5 sm:p-6', className)}>
    {title ? (
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-medium text-white">{title}</h2>
        {action}
      </div>
    ) : null}
    {children}
  </div>
);

export const FieldLabel: React.FC<{ children: React.ReactNode; htmlFor?: string }> = ({
  children,
  htmlFor,
}) => (
  <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-gray-400">
    {children}
  </label>
);

export const TextInput = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={cn(
      'h-10 w-full rounded-lg border border-white/15 bg-transparent px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-primary',
      className,
    )}
  />
);

export const AmountInput: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (value: string) => void;
  }
> = ({ value, onChange, className, ...props }) => (
  <TextInput
    {...props}
    inputMode="decimal"
    autoComplete="off"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={cn('tabular-nums', className)}
  />
);

const POPULAR_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY', 'CHF'];

export const CurrencySelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  id?: string;
}> = ({ value, onChange, id }) => (
  <select
    id={id}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className="h-10 w-full rounded-lg border border-white/15 bg-background px-3 text-sm text-white outline-none focus:border-primary"
  >
    <optgroup label="Popular">
      {POPULAR_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code} · {CURRENCIES.find((c) => c.code === code)?.name ?? code}
        </option>
      ))}
    </optgroup>
    <optgroup label="All currencies">
      {CURRENCIES.filter((c) => !POPULAR_CURRENCIES.includes(c.code)).map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} · {c.name}
        </option>
      ))}
    </optgroup>
  </select>
);

const AVATAR_COLORS = [
  'bg-cyan-500/20 text-cyan-200',
  'bg-emerald-500/20 text-emerald-200',
  'bg-violet-500/20 text-violet-200',
  'bg-amber-500/20 text-amber-200',
  'bg-rose-500/20 text-rose-200',
  'bg-sky-500/20 text-sky-200',
  'bg-lime-500/20 text-lime-200',
  'bg-fuchsia-500/20 text-fuchsia-200',
] as const;

export const PersonAvatar: React.FC<{ name: string; index: number; size?: 'sm' | 'md' }> = ({
  name,
  index,
  size = 'md',
}) => (
  <span
    aria-hidden
    className={cn(
      'flex shrink-0 items-center justify-center rounded-full font-medium',
      'sm' === size ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs',
      AVATAR_COLORS[index % AVATAR_COLORS.length],
    )}
  >
    {(name.trim() || '?').slice(0, 1).toUpperCase()}
  </span>
);

/**
 * A text field that saves on blur or Enter instead of on every keystroke, and follows `value` while
 * it isn't focused, so updates from other people don't overwrite what someone is typing.
 */
export const CommitInput: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
    value: string;
    onCommit: (value: string) => void;
    allowEmpty?: boolean;
  }
> = ({ value, onCommit, allowEmpty = false, ...props }) => {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(value);
    }
  }, [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value || (!next && !allowEmpty)) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };

  return (
    <input
      {...props}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if ('Enter' === e.key) {
          e.currentTarget.blur();
        }
        if ('Escape' === e.key) {
          cancelled.current = true;
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
};

export const PeopleEditor: React.FC<{
  people: readonly { id: string; name: string }[];
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onAdd: (name: string) => void;
  locked?: ReadonlySet<string>;
  min?: number;
  max?: number;
}> = ({ people, onRename, onRemove, onAdd, locked, min = 2, max = 20 }) => {
  const [draft, setDraft] = useState('');

  const add = () => {
    if (people.length >= max) {
      return;
    }
    onAdd(draft.trim() || `Person ${people.length + 1}`);
    setDraft('');
  };

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {people.map((person, index) => (
          <div
            key={person.id}
            className="flex items-center gap-2 rounded-lg border border-white/10 py-1.5 pl-1.5 pr-2"
          >
            <PersonAvatar name={person.name} index={index} />
            <CommitInput
              aria-label={`Name of person ${index + 1}`}
              value={person.name}
              maxLength={40}
              onCommit={(name) => onRename(person.id, name)}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"
            />
            <button
              type="button"
              aria-label={`Remove ${person.name}`}
              title={locked?.has(person.id) ? 'Remove their expenses first' : undefined}
              disabled={people.length <= min || locked?.has(person.id)}
              onClick={() => onRemove(person.id)}
              className="rounded-full p-1 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {people.length < max ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <TextInput
            aria-label="New person's name"
            placeholder="Add a person"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-gray-200 transition-colors hover:bg-white/5"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      ) : null}
    </div>
  );
};

export const Segmented = <T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
  size?: 'sm' | 'md';
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="inline-flex w-full rounded-lg border border-white/15 p-0.5 sm:w-auto"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          'flex-1 rounded-md text-sm transition-colors sm:flex-none',
          'sm' === size ? 'px-3 py-1.5 text-xs' : 'px-4 py-2',
          value === option.value
            ? 'bg-white/10 font-medium text-white'
            : 'text-gray-400 hover:text-gray-200',
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const Chip: React.FC<{
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ selected, onClick, children, className }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
      selected
        ? 'border-primary/60 bg-primary/10 text-white'
        : 'border-white/15 text-gray-500 hover:text-gray-300',
      className,
    )}
  >
    {children}
  </button>
);

const useCopied = () => {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), 1800);
      })
      .catch(console.error);
  };
  return { copied, copy };
};

export const ShareActions: React.FC<{
  shareUrl: () => Promise<string>;
  summary: (url: string) => string;
  title: string;
}> = ({ shareUrl, summary, title }) => {
  const { copied, copy } = useCopied();

  const share = async () => {
    const url = await shareUrl();
    if ('function' === typeof navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    copy('link', url);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => share().catch(console.error)}
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:flex-none"
      >
        {'link' === copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {'link' === copied ? 'Link copied' : 'Share link'}
      </button>
      <button
        type="button"
        onClick={() => {
          shareUrl()
            .then((url) => copy('text', summary(url)))
            .catch(console.error);
        }}
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm text-gray-200 transition-colors hover:bg-white/5 sm:flex-none"
      >
        {'text' === copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {'text' === copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  );
};

export const EmptyHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-gray-500">
    {children}
  </p>
);
