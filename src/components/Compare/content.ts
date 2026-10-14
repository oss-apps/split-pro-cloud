import { type FaqItem } from '~/components/Site/blocks';

/**
 * Comparison pages at /compare/[slug]. Competitor facts come from their own sites, help centers
 * and store listings (see `sources`), checked on `reviewed`. Re-check them before changing a row.
 */

export const COMPARE_PATH = '/compare';

export interface ComparisonRow {
  label: string;
  splitpro: string;
  competitor: string;
}

export interface Comparison {
  slug: string;
  competitor: string;
  seoTitle: string;
  description: string;
  reviewed: string;
  summary: readonly string[];
  rows: readonly ComparisonRow[];
  competitorStrengths: readonly string[];
  splitproStrengths: readonly string[];
  chooseSplitPro: string;
  chooseCompetitor: string;
  faqs: readonly FaqItem[];
  sources: readonly { label: string; href: string }[];
}

export const COMPARISONS: readonly Comparison[] = [
  {
    slug: 'splitpro-vs-splitwise',
    competitor: 'Splitwise',
    seoTitle: 'SplitPro vs Splitwise: a free, open source alternative compared | SplitPro',
    description:
      'How SplitPro and Splitwise compare on daily limits, split types, currencies, apps and moving your data, and where each one is the better pick.',
    reviewed: '2026-10-14',
    summary: [
      'Both apps track shared expenses with friends and in groups, and both split equally, by percentage, by shares or by exact amounts. The biggest difference is the free plan: Splitwise’s free plan lets you add up to 4 expenses a day, while SplitPro has no daily limit. SplitPro is also open source, so anyone can read the code or run their own copy.',
      'Splitwise has been around much longer and does more. It has native iPhone and Android apps, offline entry, several payers on one expense and simplify debts, plus Pro features such as receipt scanning, currency conversion and charts.',
    ],
    rows: [
      {
        label: 'Expenses you can add per day',
        splitpro: 'Unlimited',
        competitor: 'Up to 4 on free',
      },
      {
        label: 'Equal, percentage, shares and exact splits',
        splitpro: 'Yes',
        competitor: 'Yes',
      },
      { label: 'Default split per group', splitpro: 'Free', competitor: 'Pro' },
      { label: 'Recurring expenses', splitpro: 'Free', competitor: 'Yes' },
      {
        label: 'Currencies',
        splitpro: '100+, balances kept per currency',
        competitor: '100+, converting to one currency is Pro',
      },
      {
        label: 'Receipts',
        splitpro: 'Attach a photo',
        competitor: 'Scanning and itemizing are Pro',
      },
      { label: 'Simplify debts in a group', splitpro: 'Only in quick split', competitor: 'Yes' },
      { label: 'Several payers on one expense', splitpro: 'No', competitor: 'Yes' },
      { label: 'Add expenses offline', splitpro: 'No', competitor: 'Yes' },
      {
        label: 'Where it runs',
        splitpro: 'Any browser, can be added to your home screen',
        competitor: 'iPhone, Android and web',
      },
      {
        label: 'Export your data',
        splitpro: 'CSV per friend, full JSON download',
        competitor: 'CSV',
      },
      { label: 'Open source, can run your own copy', splitpro: 'Yes', competitor: 'No' },
    ],
    competitorStrengths: [
      'Native iPhone and Android apps, and you can add expenses offline.',
      'Several people can pay for one expense, and simplify debts turns a group’s balances into fewer payments.',
      'Built-in ways to pay back: Venmo and PayPal in the US, and Paytm in India.',
      'Comments on expenses, edit history, restoring deleted bills, and more than 7 languages.',
      'Pro adds receipt scanning with itemization, currency conversion, charts, search and card transaction import (US only).',
    ],
    splitproStrengths: [
      'No daily cap on adding expenses, and no paid plan for the basics.',
      'Default split per group, recurring expenses and receipt photos are all free.',
      'Open source under the MIT license, so you can read the code or host it yourself.',
      'Imports your friends and groups, with their balances, from a Splitwise backup.',
      'Quick split settles a one-off trip without anyone creating an account.',
    ],
    chooseSplitPro:
      'You add more than a few expenses a day, you want the core features to stay free, or you want software you can inspect and run yourself.',
    chooseCompetitor:
      'You need a native app that works offline, several payers on one expense, built-in payments or receipt scanning, and you are fine with Pro or with 4 expenses a day.',
    faqs: [
      {
        question: 'Is SplitPro a free alternative to Splitwise?',
        answer:
          'Yes. Signing up, adding expenses, groups, recurring expenses, receipts and settling up are free in SplitPro, with no daily limit on expenses. Splitwise’s free plan allows up to 4 expenses a day; Splitwise Pro removes that limit.',
      },
      {
        question: 'Can I move my Splitwise data to SplitPro?',
        answer:
          'SplitPro imports your friends and groups, with their current balances, from a Splitwise JSON backup. It does not import past individual expenses, so keep a Splitwise export if you want that history. Splitwise’s help center says Pro users can download the backup on the web, and free users can ask Splitwise support for an export.',
      },
      {
        question: 'Does SplitPro have a mobile app?',
        answer:
          'SplitPro runs in your browser, so there is nothing to download. On your phone you can add it to your home screen, where it opens like an app and can send notifications. Splitwise has native iPhone and Android apps.',
      },
      {
        question: 'Does SplitPro simplify debts like Splitwise?',
        answer:
          'Not in groups yet. In a SplitPro group you settle up with each member, or with a friend across one currency. SplitPro’s quick split, which needs no account, does suggest the fewest payments to settle everyone.',
      },
    ],
    sources: [
      {
        label: 'Splitwise help center: What is Splitwise Pro?',
        href: 'https://kb.splitwise.com/pro/what-is-splitwise-pro',
      },
      { label: 'Splitwise Pro', href: 'https://www.splitwise.com/pro' },
      {
        label: 'Splitwise on the App Store',
        href: 'https://apps.apple.com/us/app/splitwise/id458023433',
      },
    ],
  },
  {
    slug: 'splitpro-vs-tricount',
    competitor: 'Tricount',
    seoTitle: 'SplitPro vs Tricount: which group expense app fits you? | SplitPro',
    description:
      'How SplitPro and Tricount compare on price, accounts, split types, currencies, offline use and apps, and when each one is the better choice.',
    reviewed: '2026-10-14',
    summary: [
      'Tricount and SplitPro are both free with no daily limit on expenses. Tricount, owned by the bank bunq, says it has no ads and no limits, and you can try it without signing up. SplitPro is open source.',
      'The main difference is how they are organized. Tricount keeps one shared list per trip or household, in iPhone and Android apps that also work offline. SplitPro gives you one account that ties together all your groups and one-to-one balances with friends, and runs in the browser.',
    ],
    rows: [
      { label: 'Price', splitpro: 'Free', competitor: 'Free' },
      { label: 'Daily expense limit', splitpro: 'None', competitor: 'None' },
      {
        label: 'Account needed',
        splitpro: 'Free account; quick split needs none',
        competitor: 'Can try without signing up',
      },
      {
        label: 'Split types',
        splitpro: 'Equal, percentage, shares, exact, adjustments',
        competitor: 'Equal or a custom share per person',
      },
      {
        label: 'One balance per friend across groups',
        splitpro: 'Yes',
        competitor: 'Not listed',
      },
      { label: 'Recurring expenses', splitpro: 'Yes', competitor: 'Not listed' },
      {
        label: 'Currencies',
        splitpro: '100+, balances kept per currency',
        competitor: 'Several, with the trip total in one currency',
      },
      { label: 'Add expenses offline', splitpro: 'No', competitor: 'Yes' },
      {
        label: 'Where it runs',
        splitpro: 'Any browser, can be added to your home screen',
        competitor: 'iPhone and Android',
      },
      {
        label: 'Import from Splitwise',
        splitpro: 'Friends and groups, with balances',
        competitor: 'Group expenses',
      },
      {
        label: 'Payments',
        splitpro: 'Record payments',
        competitor: 'Payment requests, optional bunq card',
      },
      { label: 'Open source, can run your own copy', splitpro: 'Yes', competitor: 'No' },
    ],
    competitorStrengths: [
      'You can try it without signing up, so friends join quickly.',
      'Native iPhone and Android apps that let you add expenses without signal and sync later.',
      'Shows a trip’s total in one currency when you spend in several.',
      'Its Splitwise importer brings over group expenses, not just balances.',
      'Income, transfers, payment requests, a built-in calculator and spending insights in the same app.',
      'An optional bunq card can add shared purchases to a tricount automatically.',
    ],
    splitproStrengths: [
      'One account for all your groups, plus one-to-one balances with friends outside any group.',
      'More ways to split: percentage, shares and adjustments as well as equal and exact amounts.',
      'Recurring expenses for rent and subscriptions, and a default split for each group.',
      'Works in any browser, on a phone or a computer.',
      'Open source under the MIT license, so you can read the code or host it yourself.',
      'Quick split covers a one-off trip with no accounts at all.',
    ],
    chooseSplitPro:
      'You split with the same people month after month, like rent with roommates, and want every group and friend in one place, or you prefer open source software.',
    chooseCompetitor:
      'You are planning a trip, want a phone app that works without signal, and want people to join without creating an account.',
    faqs: [
      {
        question: 'Is Tricount free?',
        answer:
          'Tricount’s site says it is free, with no ads and no limits. It is owned by the bank bunq and offers optional bunq services, such as a card and paid eSIM data plans for travel. SplitPro is also free, with no daily limit.',
      },
      {
        question: 'Can I use SplitPro without an account, like Tricount?',
        answer:
          'Yes, with quick split. Add names and expenses, share one link, and everyone can see and edit the split without signing up. For groups you share costs with over time, a free account keeps a running tab across groups and friends.',
      },
      {
        question: 'Which is better for a trip abroad?',
        answer:
          'Tricount works offline and can show the trip total in one currency, which helps on the road. SplitPro keeps each expense in the currency you paid in and balances per currency, without converting, and needs a connection to add expenses.',
      },
      {
        question: 'Can I move from Tricount to SplitPro?',
        answer:
          'SplitPro has no Tricount importer. The simplest way is to settle up in Tricount, then create the group in SplitPro and add new expenses there.',
      },
    ],
    sources: [
      { label: 'tricount home page', href: 'https://www.tricount.com/' },
      { label: 'tricount features', href: 'https://tricount.com/features' },
    ],
  },
  {
    slug: 'splitpro-vs-settle-up',
    competitor: 'Settle Up',
    seoTitle: 'SplitPro vs Settle Up: features and pricing compared | SplitPro',
    description:
      'How SplitPro and Settle Up compare on what is free, split types, currencies, offline use and apps, and when each one is the better choice.',
    reviewed: '2026-10-14',
    summary: [
      'Settle Up is a group expense app for Android, iPhone and the web, with a free version and an optional Premium upgrade. SplitPro is free and open source, with no daily limit on expenses.',
      'Settle Up handles more complex cases out of the box: several payers on one expense, weights, incomes, offline use and live exchange rates, and it minimizes the transfers needed to settle. Receipt photos, categories, recurring transactions, Excel export and charts are Premium. In SplitPro, receipt photos, categories and recurring expenses are free, but there is no offline mode, no charts and no currency conversion.',
    ],
    rows: [
      { label: 'Price', splitpro: 'Free', competitor: 'Free, with optional Premium' },
      {
        label: 'Split types',
        splitpro: 'Equal, percentage, shares, exact, adjustments',
        competitor: 'Even, weights, items from a bill',
      },
      { label: 'Several payers on one expense', splitpro: 'No', competitor: 'Yes' },
      {
        label: 'Fewest payments to settle a group',
        splitpro: 'Only in quick split',
        competitor: 'Yes',
      },
      { label: 'Recurring expenses', splitpro: 'Free', competitor: 'Premium' },
      { label: 'Receipt photos', splitpro: 'Free', competitor: 'Premium' },
      { label: 'Expense categories', splitpro: 'Free', competitor: 'Premium' },
      {
        label: 'Currencies',
        splitpro: '100+, balances kept per currency',
        competitor: 'All, with real-time exchange rates',
      },
      { label: 'Add expenses offline', splitpro: 'No', competitor: 'Yes' },
      {
        label: 'Export your data',
        splitpro: 'CSV per friend, full JSON download',
        competitor: 'CSV; Excel is Premium',
      },
      { label: 'Charts', splitpro: 'No', competitor: 'Premium' },
      {
        label: 'Where it runs',
        splitpro: 'Any browser, can be added to your home screen',
        competitor: 'Android, iPhone and web',
      },
      { label: 'Open source, can run your own copy', splitpro: 'Yes', competitor: 'No' },
    ],
    competitorStrengths: [
      'Native Android and iPhone apps that work offline, plus a web app and a widget for quick expenses.',
      'Several payers on one expense, weights per member, incomes and items from a long bill.',
      'Works out the fewest transfers to settle the group, with real-time exchange rates.',
      'Friends can view a group in the browser from a shared link or QR code without downloading anything, and you can give read-only access.',
      'Translated into many languages, and Premium can be bought once for a single group instead of as a subscription.',
    ],
    splitproStrengths: [
      'Receipt photos, categories and recurring expenses are free, with no premium tier.',
      'A default split per group, so new expenses start the way your group usually splits.',
      'One account for all your groups and one-to-one balances with friends.',
      'Imports your friends and groups, with balances, from a Splitwise backup.',
      'Open source under the MIT license, so you can read the code or host it yourself.',
    ],
    chooseSplitPro:
      'You want receipts, categories and repeating costs like rent without paying for an upgrade, or you prefer open source software.',
    chooseCompetitor:
      'You need offline use, several payers on one expense, currency conversion or charts, or you want a native app with many languages.',
    faqs: [
      {
        question: 'Is Settle Up free?',
        answer:
          'Yes, Settle Up has a free version. Its Google Play listing says it contains ads. Premium removes the ads and adds receipt photos, categories, recurring transactions, Excel export and charts. It comes as a subscription, or as a one-time purchase for a single group.',
      },
      {
        question: 'Does SplitPro work offline?',
        answer:
          'No. SplitPro needs a connection to add expenses. If you often split costs without signal, Settle Up’s offline mode is a real advantage.',
      },
      {
        question: 'Which handles multiple currencies better?',
        answer:
          'Settle Up supports all currencies with real-time exchange rates. SplitPro supports more than 100 currencies and keeps each expense, and each balance, in the currency it was paid in, without converting.',
      },
      {
        question: 'Can friends see balances without installing an app?',
        answer:
          'In both. Settle Up lets friends view a group in the browser from a shared link. SplitPro runs in the browser: friends sign in with the email you added them with, and quick split shares a link that needs no account.',
      },
    ],
    sources: [
      {
        label: 'Settle Up on Google Play',
        href: 'https://play.google.com/store/apps/details?id=cz.destil.settleup',
      },
      {
        label: 'Settle Up on the App Store',
        href: 'https://apps.apple.com/us/app/settle-up-group-expenses/id737534985',
      },
      { label: 'Settle Up Premium', href: 'https://settleup.app/premium' },
    ],
  },
];

export const getComparison = (slug: string) => COMPARISONS.find((c) => c.slug === slug);
