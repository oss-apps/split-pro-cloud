import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { addRecentCurrency } from '~/hooks/useRecentCurrencies';

import { storage } from '@/lib/storage';

interface RecentCurrenciesState {
  /** Currencies used on this device, newest first. */
  recent: string[];
  remember: (code: string) => void;
}

/** Known codes only, without duplicates, newest first, like the web's localStorage reader. */
const parseRecentCurrencies = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((code): code is string => 'string' === typeof code)
        .reduceRight<string[]>((recent, code) => addRecentCurrency(recent, code), [])
    : [];

/** Like the web's `useRecentCurrencies`, saved on the device. */
export const useRecentCurrencies = create<RecentCurrenciesState>()(
  persist(
    (set) => ({
      recent: [],
      remember: (code) => set((state) => ({ recent: addRecentCurrency(state.recent, code) })),
    }),
    {
      name: 'splitpro.recentCurrencies',
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ recent: state.recent }),
      merge: (persisted, current) => ({
        ...current,
        recent: parseRecentCurrencies((persisted as { recent?: unknown } | undefined)?.recent),
      }),
    },
  ),
);
