import { ArrowRight, Github, Menu, X } from 'lucide-react';
import Head from 'next/head';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { cn } from '~/lib/utils';
import { AUTHOR_URL, GITHUB_URL, ISSUES_URL, SPONSOR_URL, TOOLS, TWITTER_URL } from './constants';

const NAV_LINKS = [
  { href: '/tools', label: 'Free tools' },
  { href: '/blog', label: 'Blog' },
  { href: '/blog/need-for-splitwise-alternative', label: 'Why SplitPro' },
] as const;

export const SiteLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      {process.env.NODE_ENV === 'production' ? (
        <Head>
          <script async defer src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
        </Head>
      ) : null}
      <SiteBackground />
      <SiteHeader />
      <main className="relative">{children}</main>
      <SiteFooter />
    </div>
  );
};

const SiteBackground = () => (
  <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[900px]">
    <div className="absolute left-1/2 top-[-320px] h-[640px] w-[1100px] -translate-x-1/2 rounded-full bg-cyan-500/[0.13] blur-[120px]" />
    <div className="absolute right-[-200px] top-[160px] h-[420px] w-[520px] rounded-full bg-violet-500/[0.07] blur-[120px]" />
    <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
  </div>
);

export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <Link href="/" className={cn('flex items-center gap-2.5', className)}>
    <Image
      src="/logo_circle.png"
      alt=""
      width={32}
      height={32}
      className="h-8 w-8 rounded-full ring-1 ring-white/10"
    />
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
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl">
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
            className="hidden rounded-full px-4 py-2 text-sm text-gray-300 transition-colors hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/balances"
            className="group flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-100"
          >
            Open app
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="ml-1 rounded-full p-2 text-gray-300 hover:text-white md:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open ? (
        <nav className="border-t border-white/[0.06] px-5 pb-5 pt-2 md:hidden">
          {[...NAV_LINKS, { href: '/auth/signin', label: 'Sign in' }].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block border-b border-white/[0.04] py-3 text-gray-200 last:border-0"
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
      { href: '/blog/need-for-splitwise-alternative', label: 'Why SplitPro' },
      { href: ISSUES_URL, label: 'Report a problem' },
    ],
  },
  {
    title: 'Free tools',
    links: [{ href: '/tools', label: 'All tools' }, ...TOOLS.map((t) => ({ ...t, label: t.name }))],
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
  <footer className="relative mt-32 border-t border-white/[0.06]">
    <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1.3fr_repeat(4,1fr)] lg:px-8">
      <div className="max-w-xs">
        <Logo />
        <p className="mt-4 text-sm leading-relaxed text-gray-400">
          The open source way to share expenses with friends, roommates and travel buddies.
        </p>
        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/[0.06] px-4 py-2 text-sm text-pink-200 transition-colors hover:border-pink-400/60"
        >
          <span aria-hidden>♥</span> Sponsor SplitPro
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
    <div className="border-t border-white/[0.06]">
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
