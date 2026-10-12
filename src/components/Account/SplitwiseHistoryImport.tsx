import { useState } from 'react';
import Link from 'next/link';

import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Separator } from '~/components/ui/separator';
import { LoadingSpinner } from '~/components/ui/spinner';
import {
  type ImportItemResult,
  type ImportPlan,
  type PlanItem,
  MAX_IMPORT_BODY_BYTES,
} from '~/lib/splitwiseImport';
import { api } from '~/utils/api';

type ItemStatus =
  | { state: 'waiting' }
  | { state: 'importing' }
  | { state: 'done'; result: ImportItemResult }
  | { state: 'failed'; error: string };

const plural = (count: number, word: string) => `${count} ${word}${1 === count ? '' : 's'}`;

const importItem = async (item: PlanItem): Promise<ItemStatus> => {
  const body = JSON.stringify(item.request);
  if (MAX_IMPORT_BODY_BYTES < new Blob([body]).size) {
    return { state: 'failed', error: 'This is too large to import in one go.' };
  }

  try {
    const response = await fetch('/api/import-splitwise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const result = (await response.json().catch(() => null)) as
      | (ImportItemResult & { error?: undefined })
      | { error?: string }
      | null;

    if (!response.ok || !result || !('status' in result)) {
      return {
        state: 'failed',
        error: result?.error ?? `The import failed (${response.status}). Please try again.`,
      };
    }
    return { state: 'done', result };
  } catch {
    return {
      state: 'failed',
      error: "Couldn't reach SplitPro. Check your connection and try again.",
    };
  }
};

/**
 * Imports a file from the exporter with expense history: one request per group or set of friends,
 * one after the other, with a summary at the end.
 */
export const SplitwiseHistoryImport: React.FC<{ plan: ImportPlan }> = ({ plan }) => {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(plan.items.map((item) => [item.key, !item.problem])),
  );
  const [statuses, setStatuses] = useState<Record<string, ItemStatus>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const utils = api.useUtils();

  const chosen = plan.items.filter((item) => selected[item.key] && !item.problem);
  const groups = plan.items.filter((item) => item.key.startsWith('group:'));
  const friends = plan.items.filter((item) => item.key.startsWith('friends:'));

  const onImport = async () => {
    setRunning(true);
    setFinished(false);
    setStatuses(Object.fromEntries(chosen.map((item) => [item.key, { state: 'waiting' }])));

    for (const item of chosen) {
      setStatuses((current) => ({ ...current, [item.key]: { state: 'importing' } }));
      const status = await importItem(item);
      setStatuses((current) => ({ ...current, [item.key]: status }));
    }

    setRunning(false);
    setFinished(true);
    utils.invalidate().catch(console.error);
  };

  const done = Object.values(statuses).filter((s) => 'done' === s.state || 'failed' === s.state);
  const results = chosen
    .map((item) => ({ item, status: statuses[item.key] }))
    .filter(({ status }) => status && ('done' === status.state || 'failed' === status.state));
  const importedResults = results.flatMap(({ status }) =>
    status?.state === 'done' && 'imported' === status.result.status ? [status.result] : [],
  );
  const problems = results.flatMap(({ item, status }) => {
    if (status?.state === 'failed') return [{ item, reasons: [status.error] }];
    if (status?.state === 'done' && 'refused' === status.result.status) {
      return [{ item, reasons: status.result.reasons }];
    }
    return [];
  });

  const renderItem = (item: PlanItem, index: number, list: PlanItem[]) => {
    const status = statuses[item.key];
    return (
      <div key={item.key}>
        <div className="flex items-start justify-between gap-3">
          <label className="flex items-start gap-2">
            <Checkbox
              className="mt-1"
              checked={!item.problem && !!selected[item.key]}
              disabled={!!item.problem || running}
              onCheckedChange={(checked) =>
                setSelected((current) => ({ ...current, [item.key]: !!checked }))
              }
            />
            <div>
              <p>{item.label}</p>
              {item.problem ? <p className="text-sm text-orange-600">{item.problem}</p> : null}
            </div>
          </label>
          <div className="shrink-0 text-right text-sm text-gray-400">
            <p>{plural(item.expenseCount, 'expense')}</p>
            {item.deletedCount ? (
              <p className="text-xs">{item.deletedCount} deleted, skipped</p>
            ) : null}
            {status?.state === 'importing' ? (
              <p className="text-xs text-primary">Importing…</p>
            ) : status?.state === 'done' && 'imported' === status.result.status ? (
              <p className="text-xs text-green-500">Imported</p>
            ) : status?.state === 'done' || status?.state === 'failed' ? (
              <p className="text-xs text-orange-600">Not imported</p>
            ) : null}
          </div>
        </div>
        {index !== list.length - 1 ? <Separator className="mt-3" /> : null}
      </div>
    );
  };

  return (
    <div>
      <div className="mt-4 text-sm text-gray-400">
        Each group, and your expenses with friends outside groups, comes over with its full history.
        Before anything is saved, the balances are checked against the ones Splitwise reports;
        anything that doesn&apos;t match is left out and listed at the end. Importing the same file
        again doesn&apos;t add anything twice.
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Button onClick={onImport} disabled={running || !chosen.length} size="sm">
          {running ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner /> Importing {Math.min(done.length + 1, chosen.length)} of{' '}
              {chosen.length}
            </span>
          ) : (
            `Import ${plural(
              chosen.reduce((sum, item) => sum + item.expenseCount, 0),
              'expense',
            )}`
          )}
        </Button>
        {running ? (
          <div className="h-2 flex-1 overflow-hidden rounded bg-gray-800" aria-hidden>
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(done.length / Math.max(chosen.length, 1)) * 100}%` }}
            />
          </div>
        ) : null}
      </div>

      {finished ? (
        <div className="mt-6 rounded border p-4" role="status">
          <p className="font-semibold">Import finished</p>
          <p className="mt-2 text-sm">
            {plural(
              importedResults.reduce(
                (sum, r) => sum + ('imported' === r.status ? r.imported : 0),
                0,
              ),
              'expense',
            )}{' '}
            imported.
            {importedResults.some((r) => 'imported' === r.status && r.alreadyImported)
              ? ` ${plural(
                  importedResults.reduce(
                    (sum, r) => sum + ('imported' === r.status ? r.alreadyImported : 0),
                    0,
                  ),
                  'expense',
                )} already in SplitPro left as they are.`
              : ''}
          </p>
          {problems.length ? (
            <div className="mt-4">
              <p className="font-medium text-orange-600">
                Not imported ({problems.length}). Nothing was saved for these:
              </p>
              <ul className="mt-2 flex flex-col gap-3 text-sm">
                {problems.map(({ item, reasons }) => (
                  <li key={item.key}>
                    <p className="font-medium">{item.label}</p>
                    <ul className="list-disc pl-5 text-gray-400">
                      {reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link href="/balances">
            <Button className="mt-4" size="sm" variant="secondary">
              Go to balances
            </Button>
          </Link>
        </div>
      ) : null}

      {plan.skippedExpenses || plan.unreadable ? (
        <p className="mt-4 text-sm text-gray-400">
          {plan.skippedExpenses
            ? `${plural(plan.skippedExpenses, 'expense')} in the file can't be imported: they don't include you, or belong to a group that isn't in the file. `
            : ''}
          {plan.unreadable ? `${plural(plan.unreadable, 'expense')} couldn't be read.` : ''}
        </p>
      ) : null}

      <div className="mt-8 font-semibold">Groups ({groups.length})</div>
      <div className="mt-4 flex flex-col gap-3">{groups.map(renderItem)}</div>

      <div className="mt-8 font-semibold">Friends, outside groups ({friends.length})</div>
      {friends.length ? (
        <p className="mt-1 text-sm text-gray-400">
          Friends who share an expense outside a group are imported together.
        </p>
      ) : null}
      <div className="mt-4 flex flex-col gap-3">{friends.map(renderItem)}</div>
    </div>
  );
};
