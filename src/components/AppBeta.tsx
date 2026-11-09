import { Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  ANDROID_BETA_GROUP_URL,
  ANDROID_BETA_OPT_IN_URL,
  IOS_BETA_URL,
} from '~/components/Site/constants';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

export type DevicePlatform = 'ios' | 'android' | 'desktop';

// One key per card variant, so dismissing the iPhone-only version doesn't hide the Android one later
const dismissKey = (platform: DevicePlatform) =>
  `splitpro:app-beta-card-dismissed:${platform}:${null === ANDROID_BETA_GROUP_URL ? 'ios' : 'all'}`;

const detectPlatform = (): DevicePlatform => {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) {
    return 'android';
  }
  // iPadOS reports a Mac user agent, so a touch screen is what gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && 1 < navigator.maxTouchPoints)) {
    return 'ios';
  }
  return 'desktop';
};

/** The device platform, or null until mounted, so the server render and first client render match. */
export const useDevicePlatform = () => {
  const [platform, setPlatform] = useState<DevicePlatform | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  return platform;
};

const BetaLink: React.FC<{ href: string; children: React.ReactNode; className?: string }> = ({
  href,
  children,
  className,
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className={cn('text-primary underline-offset-4 hover:underline', className)}
  >
    {children}
  </a>
);

const IosBeta: React.FC = () => (
  <div className="flex flex-col items-start gap-2">
    <Button asChild size="sm">
      <a href={IOS_BETA_URL} target="_blank" rel="noreferrer">
        Join the iOS beta
      </a>
    </Button>
    <p className="text-xs text-muted-foreground">Needs Apple&apos;s free TestFlight app.</p>
  </div>
);

const AndroidBetaSteps: React.FC<{ groupUrl: string }> = ({ groupUrl }) => (
  <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
    <li>
      <BetaLink href={groupUrl}>Join the testers group</BetaLink>
    </li>
    <li>
      Tap &quot;Become a tester&quot; on the{' '}
      <BetaLink href={ANDROID_BETA_OPT_IN_URL}>opt-in page</BetaLink>
    </li>
  </ol>
);

/** Dismissible card on the Balances page pointing at the native app beta for this device. */
export const AppBetaCard: React.FC<{ className?: string }> = ({ className }) => {
  const platform = useDevicePlatform();
  // Hidden until we've read localStorage, so it never flashes for people who dismissed it.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (null === platform) {
      return;
    }
    try {
      setDismissed('1' === localStorage.getItem(dismissKey(platform)));
    } catch {
      setDismissed(false);
    }
  }, [platform]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (null === platform) {
      return;
    }
    try {
      localStorage.setItem(dismissKey(platform), '1');
    } catch {
      // Private mode or storage disabled: it's hidden until the next reload, which is fine.
    }
  }, [platform]);

  if (null === platform || dismissed) {
    return null;
  }

  const androidGroupUrl = ANDROID_BETA_GROUP_URL;

  if ('android' === platform && null === androidGroupUrl) {
    return null;
  }

  const closeButton = (
    <button
      type="button"
      onClick={dismiss}
      aria-label="Dismiss"
      className="-m-1 shrink-0 p-1 text-muted-foreground hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  );

  if ('desktop' === platform) {
    return (
      <div
        className={cn('flex items-center justify-between gap-3 text-sm text-gray-400', className)}
      >
        {null !== androidGroupUrl ? (
          <p>
            The phone apps are in beta: <BetaLink href={IOS_BETA_URL}>iPhone</BetaLink> · Android:{' '}
            <BetaLink href={androidGroupUrl}>join the group</BetaLink>, then{' '}
            <BetaLink href={ANDROID_BETA_OPT_IN_URL}>opt in</BetaLink>
          </p>
        ) : (
          <p>
            The iPhone app is in beta. <BetaLink href={IOS_BETA_URL}>Join on TestFlight</BetaLink>
          </p>
        )}
        {closeButton}
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 rounded-2xl border px-4 py-3', className)}>
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">
              The {'ios' === platform ? 'iPhone' : 'Android'} app is in beta
            </p>
            <p className="text-sm text-muted-foreground">Try it early and tell me what breaks.</p>
          </div>
          {closeButton}
        </div>
        {'ios' === platform ? <IosBeta /> : null}
        {'android' === platform && null !== androidGroupUrl ? (
          <AndroidBetaSteps groupUrl={androidGroupUrl} />
        ) : null}
      </div>
    </div>
  );
};

/** Beta links for the "Download App" drawer: every platform that has a beta open. */
export const AppBetaLinks: React.FC = () => {
  const androidGroupUrl = ANDROID_BETA_GROUP_URL;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="font-medium">iPhone and iPad</p>
        <IosBeta />
      </div>
      {null !== androidGroupUrl ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Android</p>
          <AndroidBetaSteps groupUrl={androidGroupUrl} />
        </div>
      ) : null}
    </div>
  );
};
