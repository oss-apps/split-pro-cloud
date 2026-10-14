import Link from 'next/link';
import { CtaBand, Faq, type FaqItem } from '~/components/Site/blocks';
import { Seo, faqJsonLd } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';

const FAQS: FaqItem[] = [
  {
    question: 'Is SplitPro free?',
    answer:
      'Yes. Signing up, adding expenses, creating groups, settling up, recurring expenses, receipt photos and the Splitwise import are all free, and nothing is locked behind a paid plan. SplitPro is open source under the MIT license, so you can also run your own copy on your own server.',
  },
  {
    question: 'Are there any limits?',
    answer:
      'There is no limit on how many expenses you can add per day, and no cap on groups or friends. The limits that do exist are practical ones: a single amount or balance can be at most 21,474,836.47 in its currency, receipt photos can be up to 5 MB, and a quick split (no sign-up) holds up to 20 people. For comparison, Splitwise’s help center says its free plan allows 4 expenses per day, as of October 2026.',
  },
  {
    question: 'Does SplitPro work offline?',
    answer:
      'No. You can add SplitPro to your phone’s home screen, where it opens like an app, but adding, editing or settling up an expense needs an internet connection. Changes are not saved on your device to sync later. If you are somewhere without signal, note the expense and add it when you are back online. You can pick the date it happened when you add it.',
  },
  {
    question: 'Which currencies does SplitPro support?',
    answer:
      'More than 100. Each expense keeps the currency it was paid in, and each group has a default currency for new expenses. Balances are kept separately per currency, so a friend can owe you in euros and dollars at the same time. SplitPro does not convert between currencies with exchange rates. A quick split uses one currency for the whole split.',
  },
  {
    question: 'Can I export my data?',
    answer:
      'Yes. On a friend’s page, Export downloads a CSV file of every expense between you and that friend, including expenses in groups you share, with who paid, the amount, currency, date and each side’s share. On the Account page, “Download splitpro data” saves a JSON file with your friends, your groups and their current balances. There is no CSV export for a whole group yet.',
  },
];

export default function FaqPage() {
  return (
    <SiteLayout>
      <Seo
        title="SplitPro FAQ: free, limits, offline use, currencies and export"
        description="Answers about SplitPro: is it free, what limits apply, whether it works offline, which currencies it supports and how to export your data."
        path="/faq"
        jsonLd={faqJsonLd(FAQS)}
      />
      <section className="mx-auto max-w-3xl px-5 pt-10 sm:pt-14 lg:px-8">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Frequently asked questions
        </h1>
        <p className="mt-3 text-pretty text-lg leading-relaxed text-gray-400">
          What SplitPro costs, what it can and can’t do today, and how to take your data with you.
        </p>
        <div className="mt-10">
          <Faq items={FAQS} />
        </div>
        <p className="mt-8 text-sm text-gray-400">
          Moving from Splitwise? Read{' '}
          <Link
            href="/blog/move-from-splitwise-to-splitpro"
            className="text-primary hover:underline"
          >
            how to move from Splitwise to SplitPro
          </Link>
          .
        </p>
      </section>
      <div className="mt-24">
        <CtaBand />
      </div>
    </SiteLayout>
  );
}
