import { useCallback, useEffect, useState } from 'react';
import { CURRENCIES } from '~/lib/currency';

const STORAGE_KEY = 'splitpro.recent-currencies';
export const MAX_RECENT_CURRENCIES = 5;

const isKnownCurrency = (code: unknown): code is string =>
  'string' === typeof code && CURRENCIES.some((currency) => currency.code === code);

/** `code` first, then the others, without duplicates or unknown codes. */
export const addRecentCurrency = (recent: string[], code: string) =>
  isKnownCurrency(code)
    ? [code, ...recent.filter((other) => other !== code)].slice(0, MAX_RECENT_CURRENCIES)
    : recent;

const read = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter(isKnownCurrency))].slice(0, MAX_RECENT_CURRENCIES)
      : [];
  } catch {
    return [];
  }
};

const write = (recent: string[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // Private mode or a full quota: the list is a convenience, so skip it.
  }
};

/** Currencies recently used on this device, newest first. */
export const useRecentCurrencies = () => {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => setRecent(read()), []);

  const remember = useCallback((code: string) => {
    const next = addRecentCurrency(read(), code);
    write(next);
    setRecent(next);
  }, []);

  return { recent, remember };
};
