import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { savePendingLink, takePendingLink } from '@/lib/pendingLink';
import { useAuthStore } from '@/store/authStore';

// Read before the protected routes redirect to sign-in, which replaces the address on web.
const launchUrl = Linking.getLinkingURL();

/**
 * Remembers a link (an invite, a shared expense…) that was opened while signed out, since the
 * protected routes send it to sign-in instead. `useOpenPendingLink` opens it after sign-in. Mount
 * once, in the root layout.
 */
export const useSaveLinkWhileSignedOut = () => {
  const status = useAuthStore((state) => state.status);
  const launchHandled = useRef(false);

  useEffect(() => {
    if ('loading' === status || launchHandled.current) {
      return;
    }

    launchHandled.current = true;

    if ('signedOut' === status) {
      savePendingLink(launchUrl);
    }
  }, [status]);

  useEffect(() => {
    // On web a link opens a new page, so the launch URL covers it.
    if ('web' === Platform.OS) {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if ('signedOut' === useAuthStore.getState().status) {
        savePendingLink(url);
      }
    });
    return () => subscription.remove();
  }, []);
};

/** Opens the link saved while signed out on top of the tabs. Mount in the signed-in layout. */
export const useOpenPendingLink = () => {
  useEffect(() => {
    const href = takePendingLink();

    if (href) {
      router.push(href);
    }
  }, []);
};
