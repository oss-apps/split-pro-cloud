import { TRPCClientError, httpBatchLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';

import type { AppRouter } from '~/server/api/root';

import { getAuthToken } from '@/store/authStore';

import { API_URL } from './config';

/** Typed tRPC hooks for the web app's router, e.g. `api.user.me.useQuery()`. */
export const api = createTRPCReact<AppRouter>();

export const createTrpcClient = () =>
  api.createClient({
    // AppRouter's types point at the web's copy of superjson. Same library, separate declarations.
    transformer: superjson as unknown as AppRouter['_def']['_config']['transformer'],
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        headers: () => {
          const token = getAuthToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });

export const isUnauthorizedError = (error: unknown) =>
  error instanceof TRPCClientError &&
  ('UNAUTHORIZED' === error.data?.code || 401 === error.data?.httpStatus);

/** e.g. `RouterOutputs['user']['getBalances']` */
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
