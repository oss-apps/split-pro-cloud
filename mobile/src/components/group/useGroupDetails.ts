import { TRPCClientError } from '@trpc/client';
import { useLocalSearchParams } from 'expo-router';

import { api, isUnauthorizedError } from '@/lib/api';

/** The server answers FORBIDDEN for groups you're not in, including deleted ones. */
export const isForbiddenError = (error: unknown) =>
  error instanceof TRPCClientError && 'FORBIDDEN' === error.data?.code;

/** Not being a member won't change on retry. */
export const retryGroupQuery = (failureCount: number, error: unknown) =>
  !isUnauthorizedError(error) && !isForbiddenError(error) && 2 > failureCount;

/** The `[groupId]` route param as a number, `NaN` when it isn't one. */
export const useGroupIdParam = () => {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return /^\d+$/.test(groupId ?? '') ? Number(groupId) : NaN;
};

/** `group.getGroupDetails` for a group route, plus whether it's missing or not yours. */
export const useGroupDetails = (groupId: number) => {
  const isValidId = Number.isInteger(groupId);
  const query = api.group.getGroupDetails.useQuery(
    { groupId },
    { enabled: isValidId, retry: retryGroupQuery },
  );
  const notFound = !isValidId || isForbiddenError(query.error) || null === query.data;

  return { query, group: query.data ?? undefined, notFound };
};
