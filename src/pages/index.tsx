import {
  Bell,
  Coins,
  Divide,
  FileUp,
  Globe2,
  Import,
  Repeat,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { GITHUB_URL, QUICK_SPLIT_PATH, SITE_URL } from '~/components/Site/constants';
import {
  CtaBand,
  Faq,
  type FaqItem,
  PrimaryLink,
  SecondaryLink,
  SectionHeading,
} from '~/components/Site/blocks';
import { Seo, faqJsonLd } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';

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
      'Yes. SplitPro imports your groups and friends with their past expenses, from the file our free Splitwise exporter downloads. Balances are checked against Splitwise before anything is saved. Our blog has a step-by-step guide.',
  },
  {
    question: 'Can SplitPro add repeating costs like rent automatically?',
    answer:
      'Yes. Set an expense to repeat every day, week, month or year, or on the last day of every month. Each repeat is added like a normal expense, with the same notification as when you add one yourself. Anyone in the expense can pause or stop it. In a group, they also need to still be a member.',
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
      <QuickSplitPromo />
      <Why />
      <section className="mx-auto mt-24 max-w-3xl px-5 lg:px-8">
        <SectionHeading title="Questions" />
        <div className="mt-8">
          <Faq items={FAQS} />
        </div>
      </section>
      <div className="mt-24">
        <CtaBand />
      </div>
    </SiteLayout>
  );
}

const Hero = () => (
  <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-14 sm:pt-20 lg:grid-cols-[1.2fr_1fr] lg:px-8">
    <div className="text-center lg:text-left">
      <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
        Split expenses with friends, for free
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-gray-400 lg:mx-0">
        Add what you spent on trips, rent or dinners. SplitPro shows who owes whom. No daily limits,
        no paywall for the basics.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
        <PrimaryLink href="/auth/signin">Start splitting for free</PrimaryLink>
        <SecondaryLink href={QUICK_SPLIT_PATH}>Quick split, no sign-up</SecondaryLink>
      </div>
      <p className="mt-6 text-sm text-gray-500">
        Free · Open source · Works on any phone or computer
      </p>
    </div>
    <div className="mx-auto w-full max-w-[300px]">
      <div className="overflow-hidden rounded-[2rem] border border-white/10">
        <Image
          src="/hero.webp"
          alt="SplitPro balances screen showing what each friend owes"
          width={1125}
          height={2436}
          priority
          sizes="300px"
          className="h-auto w-full"
        />
      </div>
    </div>
  </section>
);

const FEATURES = [
  {
    icon: Divide,
    title: 'Split any way',
    description:
      'Equally, by percentage, by shares or by exact amounts. Totals add up to the cent.',
  },
  {
    icon: Users,
    title: 'Groups and friends',
    description: 'A group for every trip or home, or split a one-off cost with a friend.',
  },
  {
    icon: Repeat,
    title: 'Recurring expenses',
    description: 'Rent and subscriptions add themselves every week, month or year.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Default split per group',
    description:
      'Choose an equal, percentage or shares split, and new expenses in the group start from it.',
  },
  {
    icon: Coins,
    title: 'Settle up in a group',
    description: 'Record a payment in one group, or settle up with a friend in one currency.',
  },
  {
    icon: Globe2,
    title: '100+ currencies',
    description: 'Add each expense in the currency you paid in. Balances stay separate.',
  },
  {
    icon: Bell,
    title: 'Works like an app',
    description: 'Add it to your home screen and get notified when someone adds an expense.',
  },
  {
    icon: Import,
    title: 'Import from Splitwise',
    description: 'Bring your friends and groups over with their past expenses and balances.',
  },
  {
    icon: FileUp,
    title: 'Receipts',
    description: 'Attach a photo of the receipt to any expense.',
  },
] as const;

const Features = () => (
  <section className="mx-auto mt-24 max-w-6xl px-5 lg:px-8">
    <SectionHeading title="Everything you need to split fairly" />
    <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {FEATURES.map((feature) => (
        <div key={feature.title}>
          <feature.icon className="h-5 w-5 text-primary" />
          <h3 className="mt-3 font-medium text-white">{feature.title}</h3>
          <p className="mt-1 text-pretty text-sm leading-relaxed text-gray-400">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  </section>
);

const Showcase = () => (
  <section className="mx-auto mt-24 max-w-6xl px-5 lg:px-8">
    <SectionHeading
      title="On your phone or your laptop"
      description="Add an expense at the table, check the totals later. Everything stays in sync."
    />
    <div className="mt-10 overflow-hidden rounded-xl border border-white/10">
      <Image
        src="/Desktop.webp"
        alt="SplitPro on a desktop browser"
        width={2910}
        height={1920}
        sizes="(min-width: 1152px) 1088px, 100vw"
        className="h-auto w-full"
      />
    </div>
  </section>
);

const QuickSplitPromo = () => (
  <section className="mx-auto mt-24 max-w-6xl px-5 lg:px-8">
    <div className="flex flex-col gap-6 rounded-xl border border-white/10 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div className="max-w-xl">
        <h2 className="text-xl font-semibold text-white">Just one trip? Skip the sign-up.</h2>
        <p className="mt-2 text-gray-400">
          Add names and expenses, see who owes whom, and share one link with the group. Nobody needs
          an account.
        </p>
      </div>
      <SecondaryLink href={QUICK_SPLIT_PATH} className="shrink-0">
        Start a quick split
      </SecondaryLink>
    </div>
  </section>
);

const COMPARISON = [
  { label: 'Expenses you can add per day', splitpro: 'Unlimited', other: '4' },
  { label: 'Open source', splitpro: 'Yes', other: 'No' },
  { label: 'Run it on your own server', splitpro: 'Yes', other: 'No' },
] as const;

const Why = () => (
  <section className="mx-auto mt-24 grid max-w-6xl items-center gap-10 px-5 lg:grid-cols-2 lg:px-8">
    <div>
      <SectionHeading
        align="left"
        title="Adding an expense shouldn't cost money"
        description="Many expense apps start free, then limit the one thing you came for. SplitPro is open source, so the core stays free."
      />
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/blog/need-for-splitwise-alternative" className="text-primary hover:underline">
          Read the story
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="text-gray-400 hover:text-white"
        >
          View the source on GitHub
        </a>
      </div>
    </div>
    <div className="overflow-hidden rounded-xl border border-white/10 text-sm">
      <div className="grid grid-cols-[1.6fr_1fr_1fr] border-b border-white/10 px-5 py-3 text-gray-400">
        <span />
        <span className="font-medium text-white">SplitPro</span>
        <span>Splitwise free</span>
      </div>
      {COMPARISON.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[1.6fr_1fr_1fr] items-center border-b border-white/5 px-5 py-3 last:border-0"
        >
          <span className="pr-4 text-gray-300">{row.label}</span>
          <span className="text-white">{row.splitpro}</span>
          <span className="text-gray-500">{row.other}</span>
        </div>
      ))}
      <p className="border-t border-white/10 px-5 py-3 text-xs text-gray-500">
        Splitwise limits are from{' '}
        <a
          href="https://kb.splitwise.com/pro/what-is-splitwise-pro"
          className="underline underline-offset-2 hover:text-gray-300"
          target="_blank"
          rel="noreferrer"
        >
          its help center
        </a>{' '}
        as of October 2026.
      </p>
    </div>
  </section>
);
