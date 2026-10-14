import { type GetServerSideProps } from 'next';
import { GITHUB_URL, QUICK_SPLIT_PATH, SITE_URL } from '~/components/Site/constants';
import { getAllPosts } from '~/lib/blog';

// Follows https://llmstxt.org. Keep the facts in step with the landing page and blog.
const buildLlmsTxt = () =>
  [
    '# SplitPro',
    '',
    '> SplitPro is a free, open source web app for splitting expenses with friends, roommates and travel groups. It shows who owes whom, has no daily limit on how many expenses you can add, and works in any browser on a phone or computer.',
    '',
    `SplitPro is hosted at ${SITE_URL}. The code is MIT licensed and published on GitHub (${GITHUB_URL}), so anyone can read it or run their own copy on their own server.`,
    '',
    'What SplitPro does today:',
    '',
    '- Signing up, adding expenses, creating groups and settling up are free, with no daily limit on expenses.',
    '- Groups for trips or homes, and one-to-one balances with friends.',
    '- Split equally, by percentage, by shares, by exact amounts or with adjustments.',
    '- A default split per group (equal, percentage or shares) that new expenses start from.',
    '- Recurring expenses that repeat every day, week, month or year, or on the last day of every month. Anyone in the expense can pause or stop it.',
    '- More than 100 currencies. Each expense has its own currency and balances are kept per currency.',
    '- Settle up inside a group, or with a friend in one currency.',
    '- Receipt photos on any expense.',
    '- Runs in the browser with nothing to install. On a phone it can be added to the home screen, where it opens like an app and sends a notification when someone adds an expense.',
    '- Friends are added by email and see their balances when they sign in with that email.',
    '- Imports friends and groups, with their current balances, from a Splitwise JSON backup. Past individual expenses are not imported.',
    `- Quick split (${SITE_URL}${QUICK_SPLIT_PATH}): split one trip or dinner without an account. Add names and expenses, see who owes whom in as few payments as possible, and share one link.`,
    '',
    "Compared with Splitwise: Splitwise's help center says free users can add up to 4 expenses each day (https://kb.splitwise.com/pro/what-is-splitwise-pro, as of October 2026). SplitPro has no such limit and is open source. Splitwise is a mature, popular product, and other options such as Spliit, Tricount and Settle Up may suit some groups better.",
    '',
    '## Pages',
    '',
    `- [Home](${SITE_URL}/): What SplitPro does, with answers to common questions`,
    `- [Quick split](${SITE_URL}${QUICK_SPLIT_PATH}): Split costs for one trip without signing up`,
    `- [Blog](${SITE_URL}/blog): Guides to sharing money fairly`,
    '',
    '## Blog',
    '',
    ...getAllPosts().map(
      (post) => `- [${post.title}](${SITE_URL}/blog/${post.slug}): ${post.description}`,
    ),
    '',
    '## Optional',
    '',
    `- [Source code](${GITHUB_URL}): The open source SplitPro project on GitHub`,
    `- [Privacy policy](${SITE_URL}/privacy)`,
    `- [Terms of service](${SITE_URL}/terms)`,
    '',
  ].join('\n');

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.write(buildLlmsTxt());
  res.end();

  return { props: {} };
};

export default function LlmsTxt() {
  return null;
}
