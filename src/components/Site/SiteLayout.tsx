import { Github, Menu, X } from 'lucide-react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { cn } from '~/lib/utils';
import {
  AUTHOR_URL,
  GITHUB_URL,
  ISSUES_URL,
  QUICK_SPLIT_PATH,
  SPONSOR_URL,
  TWITTER_URL,
} from './constants';

const NAV_LINKS = [
  { href: QUICK_SPLIT_PATH, label: 'Quick split' },
  { href: '/blog', label: 'Blog' },
  { href: '/blog/need-for-splitwise-alternative', label: 'Why SplitPro' },
] as const;

export const SiteLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {process.env.NODE_ENV === 'production' ? (
        <Head>
          <script async defer src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
        </Head>
      ) : null}
      <SiteHeader />
      <div>{children}</div>
      <SiteFooter />
    </div>
  );
};

export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <Link href="/" className={cn('flex items-center gap-2.5', className)}>
    <Image src="/logo_circle.png" alt="" width={32} height={32} className="h-8 w-8 rounded-full" />
    <span className="text-lg font-semibold tracking-tight text-white">SplitPro</span>
  </Link>
);

const SiteHeader = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [router.asPath]);

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-gray-300 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'transition-colors hover:text-white',
                router.pathname === link.href && 'text-white',
              )}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-white"
          >
            <Github className="h-4 w-4" /> GitHub
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/auth/signin"
            className="hidden px-3 py-2 text-sm text-gray-300 transition-colors hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/balances"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open app
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="ml-1 rounded-lg p-2 text-gray-300 hover:text-white md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav className="border-t border-white/10 px-5 pb-5 pt-2 md:hidden">
          {[...NAV_LINKS, { href: '/auth/signin', label: 'Sign in' }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block border-b border-white/5 py-3 text-gray-200 last:border-0"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
};

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/auth/signin', label: 'Get started' },
      { href: '/balances', label: 'Open the app' },
      { href: QUICK_SPLIT_PATH, label: 'Quick split, no sign-up' },
      { href: '/blog/need-for-splitwise-alternative', label: 'Why SplitPro' },
      { href: ISSUES_URL, label: 'Report a problem' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/blog', label: 'Blog' },
      { href: '/blog/splitwise-alternatives', label: 'Splitwise alternatives' },
      { href: '/blog/how-to-split-rent-fairly', label: 'How to split rent' },
      { href: GITHUB_URL, label: 'Source code' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
] as const;

const SiteFooter = () => (
  <footer className="mt-24 border-t border-white/10">
    <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1.3fr_repeat(3,1fr)] lg:px-8">
      <div className="max-w-xs">
        <Logo />
        <p className="mt-4 text-sm leading-relaxed text-gray-400">
          The open source way to share expenses with friends, roommates and travel buddies.
        </p>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white"
        >
          <span aria-hidden className="text-pink-400">
            ♥
          </span>{' '}
          Sponsor SplitPro
        </a>
      </div>
      {FOOTER_COLUMNS.map((column) => (
        <div key={column.title}>
          <p className="text-sm font-medium text-white">{column.title}</p>
          <ul className="mt-4 space-y-3 text-sm text-gray-400">
            {column.links.map((link) => (
              <li key={link.href}>
                {link.href.startsWith('http') ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="transition-colors hover:text-white"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} className="transition-colors hover:text-white">
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
    <div className="border-t border-white/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-gray-500 sm:flex-row lg:px-8">
        <p>
          Built by{' '}
          <a href={AUTHOR_URL} target="_blank" rel="noreferrer" className="text-gray-300">
            KM Koushik
          </a>
          . Open source under the MIT license.
        </p>
        <div className="flex gap-5">
          <a href={TWITTER_URL} target="_blank" rel="noreferrer" className="hover:text-gray-300">
            Twitter
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-gray-300">
            GitHub
          </a>
        </div>
      </div>
    </div>
  </footer>
);
