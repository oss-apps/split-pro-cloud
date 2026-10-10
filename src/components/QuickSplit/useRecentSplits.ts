import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'splitpro.quick-splits';
const MAX_RECENT = 10;

export interface RecentSplit {
  id: string;
  name: string;
  openedAt: number;
}

const read = (): RecentSplit[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is RecentSplit =>
            'string' === typeof (item as RecentSplit)?.id &&
            'string' === typeof (item as RecentSplit)?.name,
        )
      : [];
  } catch {
    return [];
  }
};

const write = (splits: RecentSplit[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(splits));
  } catch {
    // Private mode or a full quota: the list is a convenience, so skip it.
  }
};

/** Splits opened in this browser, newest first. Only ids and names are kept on the device. */
export const useRecentSplits = () => {
  const [recent, setRecent] = useState<RecentSplit[]>([]);

  useEffect(() => setRecent(read()), []);

  const remember = useCallback((id: string, name: string) => {
    const next = [
      { id, name, openedAt: Date.now() },
      ...read().filter((split) => split.id !== id),
    ].slice(0, MAX_RECENT);
    write(next);
    setRecent(next);
  }, []);

  const forget = useCallback((id: string) => {
    const next = read().filter((split) => split.id !== id);
    write(next);
    setRecent(next);
  }, []);

  return { recent, remember, forget };
};
