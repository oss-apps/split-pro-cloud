import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';
import { DemoAdCreative } from './DemoAdCreative';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const MIN_ITEMS_FOR_AD = 3;
const FIRST_AD_AFTER = 5;
const REPEAT_AD_EVERY = 20;

/**
 * Whether a feed ad goes after the item at `index`. Lists shorter than 3 items get no ad. The ad
 * goes after the 5th item (or the last one in shorter lists), and with `repeat`, every 20 items
 * after that.
 */
export function isFeedAdPosition(index: number, total: number, repeat = false) {
  if (total < MIN_ITEMS_FOR_AD) {
    return false;
  }
  const position = index + 1;
  if (position === Math.min(FIRST_AD_AFTER, total)) {
    return true;
  }
  return repeat && position > FIRST_AD_AFTER && (position - FIRST_AD_AFTER) % REPEAT_AD_EVERY === 0;
}

type AdStatus = 'loading' | 'filled' | 'unfilled';

// next/script only calls onError for the first <Script> with a given id, so a blocked script is
// shared state that every slot on the page subscribes to.
let adScriptFailed = false;
const adScriptFailureListeners = new Set<() => void>();

const markAdScriptFailed = () => {
  adScriptFailed = true;
  adScriptFailureListeners.forEach((listener) => listener());
};

// Cancels the parent's flex gap while the slot is empty, so an unfilled or blocked ad leaves no
// trace in the list.
const COLLAPSED_GAP = {
  'gap-4': '-mt-4',
  'gap-8': '-mt-8',
} as const;

export const AdSlot: React.FC<{
  listGap: keyof typeof COLLAPSED_GAP;
  index?: number;
  className?: string;
}> = ({ listGap, index = 0, className }) => {
  const adConfigQuery = api.user.getAdConfig.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [status, setStatus] = useState<AdStatus>('loading');

  const config = adConfigQuery.data;
  if (!config || 'unfilled' === status) {
    return null;
  }

  const filled = 'filled' === status;

  return (
    <aside
      aria-label="Sponsored"
      className={cn(
        'grid transition-[grid-template-rows,opacity,margin] duration-500 ease-out motion-reduce:transition-none',
        filled
          ? cn('grid-rows-[1fr] opacity-100', className)
          : cn('grid-rows-[0fr] opacity-0', COLLAPSED_GAP[listGap]),
      )}
    >
      <div className="overflow-hidden">
        <div className="rounded-2xl border px-3 pb-3 pt-2.5">
          <div className="mb-2.5 flex items-center justify-between text-[11px] leading-none">
            <span className="font-medium uppercase tracking-wider text-gray-500">Sponsored</span>
            <Link href="/privacy#advertising" className="text-gray-600 hover:text-gray-400">
              Keeps SplitPro free
            </Link>
          </div>
          {'demo' in config ? (
            <DemoAdCreative index={index} onStatus={setStatus} />
          ) : (
            <InFeedAd
              client={config.client}
              slot={config.slot}
              layoutKey={config.layoutKey}
              onStatus={setStatus}
            />
          )}
        </div>
      </div>
    </aside>
  );
};

const InFeedAd: React.FC<{
  client: string;
  slot: string;
  layoutKey: string;
  onStatus: (status: AdStatus) => void;
}> = ({ client, slot, layoutKey, onStatus }) => {
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    const ins = insRef.current;
    if (!ins) {
      return;
    }

    // AdSense sets data-ad-status on the <ins> once the request settles.
    const observer = new MutationObserver(() => {
      const adStatus = ins.getAttribute('data-ad-status');
      if ('filled' === adStatus || 'unfilled' === adStatus) {
        onStatus(adStatus);
      }
    });
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });

    const onScriptFailed = () => onStatus('unfilled');
    if (adScriptFailed) {
      onScriptFailed();
    }
    adScriptFailureListeners.add(onScriptFailed);

    if (!pushed.current) {
      pushed.current = true;
      try {
        (window.adsbygoogle = window.adsbygoogle ?? []).push({});
      } catch (e) {
        console.error('Failed to load ad', e);
        onStatus('unfilled');
      }
    }

    return () => {
      observer.disconnect();
      adScriptFailureListeners.delete(onScriptFailed);
    };
  }, [onStatus]);

  return (
    <>
      <ins
        ref={insRef}
        className="adsbygoogle block"
        data-ad-format="fluid"
        data-ad-layout-key={layoutKey}
        data-ad-client={client}
        data-ad-slot={slot}
      />
      <Script
        id="adsbygoogle"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
        // Blocked by an ad blocker: drop every slot instead of leaving empty cards.
        onError={markAdScriptFailed}
      />
    </>
  );
};
