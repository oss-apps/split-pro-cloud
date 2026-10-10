import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { cn } from '~/lib/utils';
import { TOOLS } from './constants';

export const Eyebrow: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <p
    className={cn(
      'inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-1 text-xs font-medium text-cyan-200',
      className,
    )}
  >
    {children}
  </p>
);

export const SectionHeading: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
}> = ({ eyebrow, title, description, align = 'center' }) => (
  <div className={cn('max-w-2xl', 'center' === align && 'mx-auto text-center')}>
    {eyebrow ? (
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-cyan-300/80">{eyebrow}</p>
    ) : null}
    <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
      {title}
    </h2>
    {description ? (
      <p className="mt-4 text-pretty text-base leading-relaxed text-gray-400 sm:text-lg">
        {description}
      </p>
    ) : null}
  </div>
);

export const PrimaryLink: React.FC<{
  href: string;
  children: React.ReactNode;
  className?: string;
}> = ({ href, children, className }) => (
  <Link
    href={href}
    className={cn(
      'group inline-flex items-center justify-center gap-2 rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-gray-950 shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_8px_40px_-8px_rgba(34,211,238,0.6)] transition-all hover:bg-cyan-300',
      className,
    )}
  >
    {children}
    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
  </Link>
);

export const SecondaryLink: React.FC<{
  href: string;
  children: React.ReactNode;
  className?: string;
}> = ({ href, children, className }) => (
  <Link
    href={href}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-medium text-gray-100 transition-colors hover:border-white/20 hover:bg-white/[0.07]',
      className,
    )}
  >
    {children}
  </Link>
);

export interface FaqItem {
  question: string;
  answer: string;
}

export const Faq: React.FC<{ items: readonly FaqItem[] }> = ({ items }) => (
  <div className="divide-y divide-white/[0.07] rounded-2xl border border-white/[0.07] bg-white/[0.02]">
    {items.map((item) => (
      <details
        key={item.question}
        className="group px-6 [&_summary::-webkit-details-marker]:hidden"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left font-medium text-gray-100">
          {item.question}
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
        </summary>
        <p className="-mt-1 pb-5 leading-relaxed text-gray-400">{item.answer}</p>
      </details>
    ))}
  </div>
);

export const CtaBand: React.FC<{ title?: string; description?: string }> = ({
  title = 'Keep a running tab with your people',
  description = 'Groups, trips and shared homes in one place. SplitPro remembers who paid what, so nobody has to.',
}) => (
  <section className="mx-auto max-w-6xl px-5 lg:px-8">
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-cyan-400/[0.12] via-cyan-400/[0.04] to-transparent px-6 py-14 text-center sm:px-12 sm:py-20">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent"
      />
      <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-xl text-pretty text-gray-400 sm:text-lg">{description}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <PrimaryLink href="/auth/signin">Start splitting for free</PrimaryLink>
        <SecondaryLink href="/tools">Try the free tools</SecondaryLink>
      </div>
    </div>
  </section>
);

export const ToolCards: React.FC<{ exclude?: string }> = ({ exclude }) => (
  <div className="grid gap-4 md:grid-cols-3">
    {TOOLS.filter((tool) => tool.href !== exclude).map((tool) => (
      <Link
        key={tool.href}
        href={tool.href}
        className="group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04]"
      >
        <div
          aria-hidden
          className={cn(
            'absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br opacity-20 blur-2xl transition-opacity group-hover:opacity-40',
            tool.accent,
          )}
        />
        <div className={cn('h-1.5 w-10 rounded-full bg-gradient-to-r', tool.accent)} />
        <p className="mt-5 text-lg font-medium text-white">{tool.name}</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">{tool.short}</p>
        <p className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-cyan-300">
          Open tool
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </p>
      </Link>
    ))}
  </div>
);
