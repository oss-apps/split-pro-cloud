import i18n, { type BackendModule } from 'i18next';
import type ICUType from 'i18next-icu';
// The ESM build default-imports intl-messageformat, which only resolves under some bundlers.
// @ts-expect-error The CommonJS entry ships an ambient module declaration instead of its own types.
import ICUModule from 'i18next-icu/cjs';
import { useEffect, useState } from 'react';
import { initReactI18next } from 'react-i18next';
import enCommon from '../../public/locales/en/common.json';

export const DEFAULT_LANGUAGE = 'en';

// Catalogs in public/locales come unchanged from the self-hosted app's Weblate project.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'cs', name: 'Čeština' },
  { code: 'pl', name: 'Polski' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'es', name: 'Español' },
  { code: 'es-MX', name: 'Español (Mexico)' },
  { code: 'es-AR', name: 'Español (Argentina)' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'sv', name: 'Svenska' },
  { code: 'hu', name: 'Magyar' },
].sort((a, b) => a.name.localeCompare(b.name));

const ICU = ((ICUModule as { default?: unknown }).default ?? ICUModule) as typeof ICUType;

const LANGUAGE_STORAGE_KEY = 'splitpro-language';

const isSupported = (code: string) => SUPPORTED_LANGUAGES.some((l) => l.code === code);

export function getStoredLanguage() {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored && isSupported(stored) ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export async function changeLanguage(code: string) {
  await i18n.changeLanguage(code);
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Private mode: the choice lasts for this session only.
  }
}

// English ships in the bundle; other languages are fetched only when picked.
const localeBackend: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read: (language, namespace, callback) => {
    if (typeof window === 'undefined') {
      callback(null, {});
      return;
    }
    fetch(`/locales/${language}/${namespace}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${language}/${namespace}: ${res.status}`);
        return res.json() as Promise<Record<string, unknown>>;
      })
      .then((data) => callback(null, data))
      .catch((error: Error) => callback(error, false));
  },
};

if (!i18n.isInitialized) {
  i18n
    .use(ICU)
    .use(localeBackend)
    .use(initReactI18next)
    .init({
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
      load: 'currentOnly',
      ns: ['common'],
      defaultNS: 'common',
      resources: { [DEFAULT_LANGUAGE]: { common: enCommon } },
      partialBundledLanguages: true,
      initAsync: false,
      // Weblate keeps untranslated strings empty; show English instead of a blank.
      returnEmptyString: false,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
    .catch(console.error);

  i18n.on('languageChanged', (language) => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  });
}

/**
 * Applies the language saved on this device. Returns false until its strings are loaded, so
 * pages can wait instead of flashing English first.
 */
export function useStoredLanguage() {
  const [ready, setReady] = useState(() => getStoredLanguage() === i18n.language);

  useEffect(() => {
    const language = getStoredLanguage();
    if (language === i18n.language) {
      setReady(true);
      return;
    }
    i18n
      .changeLanguage(language)
      .catch(console.error)
      .finally(() => setReady(true));
  }, []);

  return ready;
}

export default i18n;
