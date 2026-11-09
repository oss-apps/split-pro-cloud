export const SITE_URL = 'https://splitpro.app';
export const SITE_NAME = 'SplitPro';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og_banner.png`;

export const GITHUB_URL = 'https://github.com/oss-apps/split-pro';
export const ISSUES_URL = 'https://github.com/oss-apps/split-pro-cloud/issues';
export const SPONSOR_URL = 'https://github.com/sponsors/KMKoushik';
export const TWITTER_URL = 'https://twitter.com/KM_Koushik_';
export const AUTHOR_URL = 'https://koushik.dev';

export const QUICK_SPLIT_PATH = '/split';

// Native app betas, linked from the landing page, the Balances page and the "Download App" drawer.
// iOS: public TestFlight link, anyone can join.
export const IOS_BETA_URL = 'https://testflight.apple.com/join/FURvpmbH';
// Android: testers join this Google Group first, then opt in on the Play testing page.
// Set the group URL once the group exists. While it's null, every Android link stays hidden.
export const ANDROID_BETA_GROUP_URL: string | null = 'https://groups.google.com/g/splitpro-beta';
export const ANDROID_BETA_OPT_IN_URL = 'https://play.google.com/apps/testing/app.splitpro';

// Same-origin on purpose; see the /stats rewrites in next.config.js.
export const UMAMI_SCRIPT_URL = '/stats/script.js';
export const UMAMI_WEBSITE_ID = '03b9ce4c-7a18-4a26-8439-6a4453cde189';
