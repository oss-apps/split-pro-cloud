/** Base URL of the SplitPro web app/API, without a trailing slash. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://splitpro.app').replace(
  /\/+$/,
  '',
);
