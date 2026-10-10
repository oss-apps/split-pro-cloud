import Link from 'next/link';
import { SITE_URL } from '~/components/Site/constants';

export const QUICK_SPLIT_DESCRIPTION =
  'Split costs for a trip, a dinner or a weekend away without signing up. Add who paid for what, see who owes whom in as few payments as possible, and share one link with everyone.';

export const QUICK_SPLIT_FAQS = [
  {
    question: 'Do my friends need to sign up?',
    answer:
      'No. Nobody needs an account. Share the link in your group chat and everyone can open it, see the balances and add expenses.',
  },
  {
    question: 'Do I need to share the link again after adding expenses?',
    answer:
      'No. The link never changes. Your split is saved on SplitPro, and everyone who has the link sees new expenses within a few seconds.',
  },
  {
    question: 'Who can see my split?',
    answer:
      'Anyone with the link can view and edit it, so share it only with the people in the split. Links are long and random, so they cannot be guessed, and split pages are hidden from search engines.',
  },
  {
    question: 'How does it keep the number of payments low?',
    answer:
      'It works out what each person paid minus what they owe, then repeatedly matches whoever owes the most with whoever is owed the most. Every payment settles at least one person, so a group of n people never needs more than n − 1 payments.',
  },
  {
    question: 'How are odd cents handled?',
    answer:
      'Everything is calculated in whole cents. When a bill does not divide evenly, the leftover cents go to the first people in the split, so the shares always add up to exactly what was paid.',
  },
] as const;

export const QuickSplitGuide = () => (
  <>
    <h2>How to split a trip without an app</h2>
    <ol>
      <li>
        <strong>Start a split</strong> and add everyone’s name. Nobody needs an account.
      </li>
      <li>
        <strong>Share the link</strong> in your group chat. Everyone sees the same split and can add
        their own expenses.
      </li>
      <li>
        <strong>Add each expense</strong> as it happens: what it was, how much, and who paid. It is
        split equally by default. Untick anyone who wasn’t part of it, or switch to exact amounts.
      </li>
      <li>
        <strong>Settle up</strong> with the suggested payments, and tap “Mark paid” as people pay
        each other back.
      </li>
    </ol>
    <h2>Why there are fewer payments than receipts</h2>
    <p>
      If Priya paid for groceries and Sam paid for dinner, you might expect everyone to pay each of
      them back. That works, but it creates a lot of small transfers. Quick split nets everything
      first, so someone who paid a little and owes a little might not need to pay anyone at all.
    </p>
    <p>
      We explain the idea step by step in{' '}
      <Link href="/blog/simplify-debts-explained">how “simplify debts” works</Link>, and share
      habits that keep group trips calm in{' '}
      <Link href="/blog/how-to-split-trip-expenses">how to split trip expenses</Link>.
    </p>
    <p>
      Splitting with the same people every month? A{' '}
      <Link href={`${SITE_URL}/auth/signin`}>free SplitPro account</Link> keeps a running tab for
      each group, with notifications, receipts and more.
    </p>
  </>
);
