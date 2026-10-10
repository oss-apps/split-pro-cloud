import { Check, Copy, Plus, Share2, X } from 'lucide-react';
import { useState } from 'react';
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
    <section className="mx-auto max-w-6xl px-5 pt-12 sm:pt-16 lg:px-8">
      <div className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-lg leading-relaxed text-gray-400">
          {description}
        </p>
      </div>
      <div className="mt-10">{children}</div>
    </section>
    <section className="mx-auto mt-28 grid max-w-6xl gap-14 px-5 lg:grid-cols-[1.4fr_1fr] lg:px-8">
      <div className="prose prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h2:text-2xl prose-p:leading-relaxed prose-p:text-gray-400 prose-a:text-cyan-300 prose-strong:text-gray-100 prose-li:text-gray-400">
        {guide}
      </div>
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">Common questions</h2>
        <div className="mt-6">
          <Faq items={faqs} />
        </div>
      </div>
    </section>
    <div className="mt-28">
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
  <div
    className={cn(
      'rounded-2xl border border-white/[0.08] bg-gray-900/50 p-5 shadow-xl shadow-black/20 backdrop-blur sm:p-6',
      className,
    )}
  >
    {title ? (
      <div className="mb-5 flex items-center justify-between gap-4">
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
  <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-gray-400">
    {children}
  </label>
);

export const TextInput = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={cn(
      'h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20',
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
    className="h-10 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
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
  'bg-cyan-400/15 text-cyan-200 ring-cyan-400/30',
  'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30',
  'bg-violet-400/15 text-violet-200 ring-violet-400/30',
  'bg-amber-400/15 text-amber-200 ring-amber-400/30',
  'bg-rose-400/15 text-rose-200 ring-rose-400/30',
  'bg-sky-400/15 text-sky-200 ring-sky-400/30',
  'bg-lime-400/15 text-lime-200 ring-lime-400/30',
  'bg-fuchsia-400/15 text-fuchsia-200 ring-fuchsia-400/30',
] as const;

export const PersonAvatar: React.FC<{ name: string; index: number; size?: 'sm' | 'md' }> = ({
  name,
  index,
  size = 'md',
}) => (
  <span
    aria-hidden
    className={cn(
      'flex shrink-0 items-center justify-center rounded-full font-medium ring-1',
      'sm' === size ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs',
      AVATAR_COLORS[index % AVATAR_COLORS.length],
    )}
  >
    {(name.trim() || '?').slice(0, 1).toUpperCase()}
  </span>
);

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
            className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/20 py-1.5 pl-1.5 pr-2"
          >
            <PersonAvatar name={person.name} index={index} />
            <input
              aria-label={`Name of person ${index + 1}`}
              value={person.name}
              onChange={(e) => onRename(person.id, e.target.value)}
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
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm text-gray-200 transition-colors hover:border-cyan-400/40 hover:text-white"
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
    className="inline-flex w-full rounded-xl border border-white/[0.08] bg-black/30 p-1 sm:w-auto"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          'flex-1 rounded-lg text-sm transition-colors sm:flex-none',
          'sm' === size ? 'px-3 py-1.5 text-xs' : 'px-4 py-2',
          value === option.value
            ? 'bg-white/10 font-medium text-white shadow-sm'
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
        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
        : 'border-white/10 text-gray-500 hover:border-white/20 hover:text-gray-300',
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
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-100 sm:flex-none"
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
        className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-white/10 px-5 text-sm text-gray-200 transition-colors hover:border-white/20 sm:flex-none"
      >
        {'text' === copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {'text' === copied ? 'Copied' : 'Copy summary'}
      </button>
    </div>
  );
};

export const EmptyHint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-gray-500">
    {children}
  </p>
);
