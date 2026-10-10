import {
  Bell,
  Check,
  Download,
  FileUp,
  GitFork,
  Globe2,
  Import,
  Sparkles,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { GITHUB_URL, SITE_URL } from '~/components/Site/constants';
import {
  CtaBand,
  Eyebrow,
  Faq,
  type FaqItem,
  PrimaryLink,
  SecondaryLink,
  SectionHeading,
  ToolCards,
} from '~/components/Site/blocks';
import { Seo, faqJsonLd } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { cn } from '~/lib/utils';

const FAQS: FaqItem[] = [
  {
    question: 'Is SplitPro really free?',
    answer:
      'Yes. Signing up, adding expenses, creating groups and settling up are all free, and there is no daily limit on how many expenses you can add.',
  },
  {
    question: 'Do I need to install an app?',
    answer:
      'No. SplitPro runs in your browser. On your phone you can add it to your home screen, where it opens like any other app and can send you notifications.',
  },
  {
    question: 'Do my friends need an account?',
    answer:
      'You can add friends by email and start adding expenses right away. They sign in with that email whenever they want to see their balances.',
  },
  {
    question: 'Can I move my groups over from Splitwise?',
    answer:
      'Yes. SplitPro imports your friends and groups, with their current balances, from a Splitwise JSON backup. Past individual expenses are not imported. Our blog has a step-by-step guide.',
  },
  {
    question: 'Which currencies are supported?',
    answer:
      'More than 100. Every expense has its own currency, and balances are kept per currency, so a trip abroad never gets mixed up with your rent.',
  },
  {
    question: 'Is SplitPro open source?',
    answer:
      'Yes, under the MIT license. Anyone can read the code, and you can run your own copy on your own server if you prefer.',
  },
];

const JSON_LD = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'SplitPro',
    url: SITE_URL,
    description:
      'Split expenses with friends, roommates and travel groups. Free, open source, with no daily limit on expenses.',
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  },
  faqJsonLd(FAQS),
];

export default function Home() {
  return (
    <SiteLayout>
      <Seo
        title="SplitPro: Split expenses with friends for free"
        description="Track shared expenses for trips, homes and nights out. See who owes whom, settle up in fewer payments, and add as many expenses as you like. Free and open source."
        path="/"
        jsonLd={JSON_LD}
      />
      <Hero />
      <Features />
      <Showcase />
      <HowItWorks />
      <section className="mx-auto mt-32 max-w-6xl px-5 lg:px-8">
        <SectionHeading
          eyebrow="Free tools"
          title="Need a quick answer? No sign-up needed."
          description="Calculators for the questions that come up every time money is shared. Share the result with a link."
        />
        <div className="mt-12">
          <ToolCards />
        </div>
      </section>
      <Why />
      <section className="mx-auto mt-32 max-w-3xl px-5 lg:px-8">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-10">
          <Faq items={FAQS} />
        </div>
      </section>
      <div className="mt-32">
        <CtaBand />
      </div>
    </SiteLayout>
  );
}

const Hero = () => (
  <section className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-8 pt-16 sm:pt-24 lg:grid-cols-[1.15fr_1fr] lg:px-8 lg:pt-28">
    <div className="text-center lg:text-left">
      <Eyebrow>
        <Sparkles className="h-3.5 w-3.5" /> Open source · No daily limits
      </Eyebrow>
      <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl">
        Split expenses with friends,{' '}
        <span className="bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 bg-clip-text text-transparent">
          for free
        </span>
      </h1>
      <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-gray-400 lg:mx-0">
        SplitPro keeps track of shared costs for trips, homes and nights out, and shows everyone
        exactly who owes whom. Add as many expenses as you like. The basics never sit behind a
        paywall.
      </p>
      <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
        <PrimaryLink href="/auth/signin">Start splitting for free</PrimaryLink>
        <SecondaryLink href="/tools/settle-up">Try the settle-up calculator</SecondaryLink>
      </div>
      <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-gray-400 lg:justify-start">
        {['Unlimited expenses', '100+ currencies', 'Works on any phone'].map((item) => (
          <li key={item} className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/10">
              <Check className="h-3 w-3 text-emerald-300" />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
    <div className="relative mx-auto w-full max-w-[340px]">
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-10 top-16 rounded-full bg-gradient-to-b from-cyan-400/30 to-violet-500/20 blur-3xl"
      />
      <PhoneFrame>
        <Image
          src="/hero.webp"
          alt="SplitPro balances screen showing what each friend owes"
          width={1125}
          height={2436}
          priority
          sizes="300px"
          className="h-auto w-full"
        />
      </PhoneFrame>
      <FloatingCard className="-left-6 top-24 sm:-left-20">
        <p className="text-[11px] text-gray-400">Lisbon trip</p>
        <p className="text-sm font-medium text-emerald-300">you get €68.03</p>
      </FloatingCard>
      <FloatingCard className="-right-4 bottom-28 sm:-right-16">
        <p className="flex items-center gap-1.5 text-sm font-medium text-white">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400">
            <Check className="h-2.5 w-2.5 text-gray-950" strokeWidth={3} />
          </span>
          Settled up with Priya
        </p>
        <p className="mt-0.5 text-[11px] text-gray-400">€42.50 · just now</p>
      </FloatingCard>
    </div>
  </section>
);

const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative rounded-[2.9rem] border border-white/15 bg-gradient-to-b from-gray-800 to-gray-900 p-2.5 shadow-2xl shadow-black/60">
    <div className="overflow-hidden rounded-[2.35rem] border border-black/60 bg-background">
      {children}
    </div>
  </div>
);

const FloatingCard: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div
    className={cn(
      'absolute rounded-2xl border border-white/10 bg-gray-900/80 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur-md',
      className,
    )}
  >
    {children}
  </div>
);

const SPLIT_TYPES = ['Equal', 'Percentage', 'Shares', 'Exact amounts', 'Adjustments'] as const;

const SPLIT_PREVIEW = [
  { name: 'Maya', share: 45, color: 'bg-cyan-400' },
  { name: 'Leo', share: 30, color: 'bg-emerald-400' },
  { name: 'Nina', share: 25, color: 'bg-violet-400' },
] as const;

const Features = () => (
  <section className="mx-auto mt-28 max-w-6xl px-5 lg:px-8">
    <SectionHeading
      eyebrow="Features"
      title="Everything you need to split fairly"
      description="From a weekend away to years of shared rent, SplitPro keeps the numbers straight."
    />
    <div className="mt-14 grid gap-4 md:grid-cols-3">
      <FeatureCard
        className="md:col-span-2"
        icon={<Sparkles className="h-5 w-5" />}
        title="Every way to split"
        description="Split equally, by percentage, by shares or by exact amounts, or adjust one person's part. The totals always add up to the cent."
      >
        <div className="mt-6 flex flex-wrap gap-2">
          {SPLIT_TYPES.map((type, index) => (
            <span
              key={type}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                1 === index
                  ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200'
                  : 'border-white/10 text-gray-400',
              )}
            >
              {type}
            </span>
          ))}
        </div>
        <div className="mt-6 space-y-3 rounded-xl border border-white/[0.06] bg-black/20 p-4">
          {SPLIT_PREVIEW.map((person) => (
            <div key={person.name} className="flex items-center gap-3 text-sm">
              <span className="w-12 text-gray-300">{person.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={cn('h-full rounded-full', person.color)}
                  style={{ width: `${person.share}%` }}
                />
              </div>
              <span className="w-10 text-right tabular-nums text-gray-400">{person.share}%</span>
            </div>
          ))}
        </div>
      </FeatureCard>
      <FeatureCard
        icon={<Users className="h-5 w-5" />}
        title="Groups and friends"
        description="Keep a group for every trip or home, or split one-off costs with a friend. Balances add up across all of them."
      />
      <FeatureCard
        icon={<Globe2 className="h-5 w-5" />}
        title="100+ currencies"
        description="Add each expense in the currency you paid in. Balances stay separate per currency."
      >
        <div className="mt-5 flex flex-wrap gap-1.5">
          {['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'SGD'].map((code) => (
            <span
              key={code}
              className="rounded-md bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-gray-400"
            >
              {code}
            </span>
          ))}
        </div>
      </FeatureCard>
      <FeatureCard
        className="md:col-span-2"
        icon={<Bell className="h-5 w-5" />}
        title="Install it like an app"
        description="Add SplitPro to your home screen on iPhone or Android and get a notification when someone adds an expense or settles up."
      >
        <div className="mt-6 max-w-sm rounded-2xl border border-white/10 bg-gray-900/80 p-3.5 shadow-lg">
          <div className="flex items-start gap-3">
            <Image
              src="/logo_circle.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-xl"
            />
            <div className="min-w-0 text-sm">
              <p className="flex items-center justify-between gap-4">
                <span className="font-medium text-white">SplitPro</span>
                <span className="text-xs text-gray-500">now</span>
              </p>
              <p className="mt-0.5 text-gray-300">Maya added “Dinner at Taberna”</p>
              <p className="text-gray-400">You owe €18.40</p>
            </div>
          </div>
        </div>
      </FeatureCard>
      <FeatureCard
        icon={<Import className="h-5 w-5" />}
        title="Import from Splitwise"
        description="Bring your friends and groups over with their balances, so you don't have to start from zero."
      />
      <FeatureCard
        icon={<FileUp className="h-5 w-5" />}
        title="Receipts"
        description="Attach a photo of the receipt to any expense, so there is never a question about what was paid."
      />
      <FeatureCard
        icon={<Download className="h-5 w-5" />}
        title="Your data, yours"
        description="Download everything you've added at any time from your account page."
      />
    </div>
  </section>
);

const FeatureCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
  children?: React.ReactNode;
}> = ({ icon, title, description, className, children }) => (
  <div
    className={cn(
      'rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 sm:p-7',
      className,
    )}
  >
    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
      {icon}
    </div>
    <h3 className="mt-5 text-lg font-medium text-white">{title}</h3>
    <p className="mt-2 text-pretty leading-relaxed text-gray-400">{description}</p>
    {children}
  </div>
);

const Showcase = () => (
  <section className="mx-auto mt-32 max-w-6xl px-5 lg:px-8">
    <SectionHeading
      eyebrow="Phone or laptop"
      title="Made for your phone. Just as good on a big screen."
      description="Add an expense at the table, then check the totals on your laptop later. Everything stays in sync."
    />
    <div className="relative mt-14">
      <div
        aria-hidden
        className="absolute inset-x-10 -bottom-6 top-10 rounded-[3rem] bg-cyan-500/10 blur-3xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gray-900 shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-gray-900 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-white/10" />
          <span className="h-3 w-3 rounded-full bg-white/10" />
          <span className="h-3 w-3 rounded-full bg-white/10" />
          <span className="mx-auto rounded-md bg-white/[0.05] px-10 py-1 text-xs text-gray-500">
            splitpro.app
          </span>
        </div>
        <Image
          src="/Desktop.webp"
          alt="SplitPro on a desktop browser"
          width={2910}
          height={1920}
          sizes="(min-width: 1152px) 1088px, 100vw"
          className="h-auto w-full"
        />
      </div>
    </div>
  </section>
);

const STEPS = [
  {
    title: 'Add your people',
    description: 'Create a group for the trip or the flat, or add a friend by email.',
  },
  {
    title: 'Add expenses as they happen',
    description: 'Who paid, how much, and how to split it. It takes about ten seconds.',
  },
  {
    title: 'Settle up when you are ready',
    description:
      'SplitPro shows exactly who owes whom. Record a payment and the balance goes back to zero.',
  },
] as const;

const HowItWorks = () => (
  <section className="mx-auto mt-32 max-w-6xl px-5 lg:px-8">
    <SectionHeading eyebrow="How it works" title="Three steps, then never think about it again" />
    <ol className="mt-14 grid gap-4 md:grid-cols-3">
      {STEPS.map((step, index) => (
        <li
          key={step.title}
          className="relative rounded-2xl border border-white/[0.07] bg-white/[0.02] p-7"
        >
          <span className="font-mono text-sm text-cyan-300">0{index + 1}</span>
          <h3 className="mt-4 text-lg font-medium text-white">{step.title}</h3>
          <p className="mt-2 leading-relaxed text-gray-400">{step.description}</p>
        </li>
      ))}
    </ol>
  </section>
);

const COMPARISON = [
  { label: 'Expenses you can add per day', splitpro: 'Unlimited', other: '4' },
  { label: 'Open source', splitpro: 'Yes', other: 'No' },
  { label: 'Run it on your own server', splitpro: 'Yes', other: 'No' },
] as const;

const Why = () => (
  <section className="mx-auto mt-32 grid max-w-6xl items-center gap-10 px-5 lg:grid-cols-2 lg:px-8">
    <div>
      <SectionHeading
        align="left"
        eyebrow="Why SplitPro"
        title="Adding an expense shouldn't cost money"
        description="Most expense apps start free and then cap the one thing you came for. SplitPro is open source, so the core of the app stays free and nobody can quietly take it away."
      />
      <div className="mt-8 flex flex-wrap gap-3">
        <SecondaryLink href="/blog/need-for-splitwise-alternative">Read the story</SecondaryLink>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm text-gray-300 hover:text-white"
        >
          <GitFork className="h-4 w-4" /> View the source
        </a>
      </div>
    </div>
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <div className="grid grid-cols-[1.6fr_1fr_1fr] border-b border-white/[0.08] px-6 py-4 text-sm">
        <span className="text-gray-500"></span>
        <span className="font-medium text-cyan-300">SplitPro</span>
        <span className="text-gray-400">Splitwise free</span>
      </div>
      {COMPARISON.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1.6fr_1fr_1fr] items-center border-b border-white/[0.05] px-6 py-4 text-sm last:border-0"
        >
          <span className="pr-4 text-gray-300">{row.label}</span>
          <span className="font-medium text-white">{row.splitpro}</span>
          <span className="text-gray-500">{row.other}</span>
        </div>
      ))}
      <p className="border-t border-white/[0.05] bg-black/20 px-6 py-3 text-xs text-gray-500">
        Splitwise limits are from{' '}
        <Link
          href="https://kb.splitwise.com/pro/what-is-splitwise-pro"
          className="underline underline-offset-2 hover:text-gray-300"
          target="_blank"
          rel="noreferrer"
        >
          its help center
        </Link>{' '}
        as of October 2026.
      </p>
    </div>
  </section>
);
