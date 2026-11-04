import { router } from 'expo-router';
import React, { useEffect } from 'react';

import { FullScreenSpinner } from '@/components/ui';

/**
 * The Google sign-in redirect (`splitpro://oauth-callback?code=…`). openAuthSessionAsync reads the
 * code itself; on Android the URL also arrives as a deep link and lands here, so step back to the
 * sign-in screen, which finishes the sign-in.
 */
const OAuthCallback = () => {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/sign-in');
  }, []);

  return <FullScreenSpinner />;
};

export default OAuthCallback;
