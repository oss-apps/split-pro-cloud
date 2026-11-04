// Hermes has no Intl.PluralRules, which i18next needs for plurals. Load it before i18next starts.
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';

import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

/**
 * Add a language by dropping `<code>.json` next to en.json (same keys), listing it here and
 * importing its `@formatjs/intl-pluralrules/locale-data/<code>.js` above. English
 * is the source of truth and the fallback for missing keys.
 */
export const resources = {
  en: { translation: en },
} as const;

type SupportedLanguage = keyof typeof resources;

const isSupported = (code: string | null | undefined): code is SupportedLanguage =>
  !!code && code in resources;

/** The first of the device's preferred languages that the app ships. */
export const getDeviceLanguage = (): SupportedLanguage => {
  const match = getLocales()
    .map((locale) => locale.languageCode)
    .find(isSupported);

  return match ?? 'en';
};

/** The device locale (e.g. `en-IN`), for number and date formatting. */
export const getDeviceLocale = () => getLocales()[0]?.languageTag ?? 'en-US';

// eslint-disable-next-line import/no-named-as-default-member -- i18next's documented setup
void i18n.use(initReactI18next).init({
  resources,
  lng: getDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
