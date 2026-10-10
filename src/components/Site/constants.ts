export const SITE_URL = 'https://splitpro.app';
export const SITE_NAME = 'SplitPro';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og_banner.png`;

export const GITHUB_URL = 'https://github.com/oss-apps/split-pro';
export const ISSUES_URL = 'https://github.com/oss-apps/split-pro-cloud/issues';
export const SPONSOR_URL = 'https://github.com/sponsors/KMKoushik';
export const TWITTER_URL = 'https://twitter.com/KM_Koushik_';
export const AUTHOR_URL = 'https://koushik.dev';

export const TOOLS = [
  {
    href: '/tools/settle-up',
    name: 'Settle-up calculator',
    short: 'Who owes whom after a trip or a night out, in as few payments as possible.',
    accent: 'from-cyan-400 to-sky-500',
  },
  {
    href: '/tools/split-bill',
    name: 'Split the bill',
    short: 'Split a restaurant bill evenly or by item, with tax and tip.',
    accent: 'from-emerald-400 to-teal-500',
  },
  {
    href: '/tools/rent-split',
    name: 'Rent split calculator',
    short: 'Split rent fairly by room size or by income.',
    accent: 'from-violet-400 to-fuchsia-500',
  },
] as const;
