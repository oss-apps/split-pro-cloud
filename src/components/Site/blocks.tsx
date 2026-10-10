import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { cn } from '~/lib/utils';
import { QUICK_SPLIT_PATH } from './constants';

export const SectionHeading: React.FC<{
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: 'left' | 'center';
}> = ({ title, description, align = 'center' }) => (
  <div className={cn('max-w-2xl', 'center' === align && 'mx-auto text-center')}>
    <h2 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
      {title}
    </h2>
    {description ? (
      <p className="mt-3 text-pretty leading-relaxed text-gray-400">{description}</p>
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
      'inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90',
      className,
    )}
  >
    {children}
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
      'inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/5',
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
  <div className="divide-y divide-white/10 border-y border-white/10">
    {items.map((item) => (
      <details key={item.question} className="group [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-left font-medium text-gray-100">
          {item.question}
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-180" />
        </summary>
        <p className="pb-4 leading-relaxed text-gray-400">{item.answer}</p>
      </details>
    ))}
  </div>
);

export const CtaBand: React.FC<{ title?: string; description?: string }> = ({
  title = 'Keep a running tab with your people',
  description = 'Groups, trips and shared homes in one place. SplitPro remembers who paid what, so nobody has to.',
}) => (
  <section className="mx-auto max-w-6xl px-5 lg:px-8">
    <div className="rounded-xl border border-white/10 px-6 py-12 text-center sm:px-12">
      <h2 className="mx-auto max-w-2xl text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-pretty text-gray-400">{description}</p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <PrimaryLink href="/auth/signin">Start splitting for free</PrimaryLink>
        <SecondaryLink href={QUICK_SPLIT_PATH}>Try a quick split</SecondaryLink>
      </div>
    </div>
  </section>
);
