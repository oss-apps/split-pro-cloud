import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { AppState, LogBox, Platform } from 'react-native';

import { api, createTrpcClient, isUnauthorizedError } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// React Query 4 warns about the custom logger below on every launch.
LogBox.ignoreLogs(['Passing a custom logger has been deprecated']);

const handleError = (error: unknown) => {
  if (!isUnauthorizedError(error)) {
    return;
  }

  // The protected routes in app/_layout.tsx send the user back to sign-in.
  void useAuthStore.getState().clearSession();
};

const createQueryClient = () =>
  new QueryClient({
    // Failed requests are shown as toasts. Logged as errors they'd also open the dev error overlay.
    logger: { log: console.info, warn: console.warn, error: console.warn },
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        retry: (failureCount, error) => !isUnauthorizedError(error) && 2 > failureCount,
      },
    },
  });

export const ApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createTrpcClient);
  const status = useAuthStore((state) => state.status);

  // React Query only knows about browser focus; refetch when the app comes back to the foreground.
  useEffect(() => {
    if ('web' === Platform.OS) {
      return;
    }

    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused('active' === state);
    });

    return () => subscription.remove();
  }, []);

  // Never show one account's cached data to the next.
  useEffect(() => {
    if ('signedOut' === status) {
      queryClient.clear();
    }
  }, [queryClient, status]);

  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </api.Provider>
  );
};
