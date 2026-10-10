import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useIsMutating } from '@tanstack/react-query';
import { useEffect } from 'react';
import { GroupView } from '~/components/QuickSplit/GroupView';
import { useRecentSplits } from '~/components/QuickSplit/useRecentSplits';
import { CtaBand } from '~/components/Site/blocks';
import { QUICK_SPLIT_PATH } from '~/components/Site/constants';
import { Seo } from '~/components/Site/Seo';
import { SiteLayout } from '~/components/Site/SiteLayout';
import { Panel } from '~/components/Tools/ToolUi';
import { api } from '~/utils/api';

const POLL_MS = 4000;

const QuickSplitGroupPage = () => {
  const router = useRouter();
  const id = 'string' === typeof router.query.id ? router.query.id : '';
  const { remember, forget } = useRecentSplits();
  const mutating = 0 < useIsMutating();

  const splitQuery = api.quickSplit.get.useQuery(
    { id },
    {
      enabled: router.isReady && 21 === id.length,
      // A poll that starts while a change is saving could briefly show the old split.
      refetchInterval: mutating ? false : POLL_MS,
      refetchOnWindowFocus: true,
      retry: (count, error) => 'NOT_FOUND' !== error.data?.code && 3 > count,
    },
  );

  const split = splitQuery.data;
  const notFound =
    (router.isReady && 21 !== id.length) || 'NOT_FOUND' === splitQuery.error?.data?.code;

  const splitId = split?.id;
  const splitName = split?.name;

  useEffect(() => {
    if (splitId && undefined !== splitName) {
      remember(splitId, splitName);
    }
  }, [splitId, splitName, remember]);

  useEffect(() => {
    if (notFound && id) {
      forget(id);
    }
  }, [notFound, id, forget]);

  return (
    <SiteLayout>
      <Seo
        title={split?.name ? `${split.name} | Quick split` : 'Quick split | SplitPro'}
        description="A shared split on SplitPro. See who paid what and who owes whom."
        path={QUICK_SPLIT_PATH}
        noindex
      />
      <section className="mx-auto max-w-6xl px-5 pt-10 sm:pt-14 lg:px-8">
        <Link
          href={QUICK_SPLIT_PATH}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quick split
        </Link>
        <div className="mt-6">
          {notFound ? (
            <Panel>
              <p className="text-lg font-medium text-white">This split does not exist</p>
              <p className="mt-2 text-sm text-gray-400">
                Check that you have the whole link. If it was copied from a message, the end may
                have been cut off.
              </p>
              <Link
                href={QUICK_SPLIT_PATH}
                className="mt-6 inline-flex h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Start a new split
              </Link>
            </Panel>
          ) : split ? (
            <GroupView split={split} />
          ) : splitQuery.error ? (
            <Panel>
              <p className="text-lg font-medium text-white">Could not load this split</p>
              <p className="mt-2 text-sm text-gray-400">{splitQuery.error.message}</p>
              <button
                type="button"
                onClick={() => splitQuery.refetch().catch(console.error)}
                className="mt-6 inline-flex h-11 items-center rounded-lg border border-white/15 px-5 text-sm text-gray-200 transition-colors hover:bg-white/5"
              >
                Try again
              </button>
            </Panel>
          ) : (
            <div className="h-[520px] animate-pulse rounded-xl border border-white/10" />
          )}
        </div>
      </section>
      <div className="mt-24">
        <CtaBand
          title="Splitting with the same people often?"
          description="A free SplitPro account keeps a running tab for every group, with notifications, receipts and more."
        />
      </div>
    </SiteLayout>
  );
};

export default QuickSplitGroupPage;
