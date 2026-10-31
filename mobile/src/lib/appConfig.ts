import { type RouterOutputs, api } from './api';

type AppConfig = RouterOutputs['user']['getAppConfig'];

/** Until the server answers: no invite emails, receipts without a preview. */
const DEFAULT_CONFIG: AppConfig = { invitesEnabled: false, storagePublicUrl: null };

/** Server settings only change with a deploy, so they're fetched about once per app run. */
const STALE_TIME = 60 * 60 * 1000;

/** The server's settings the web reads at render time, e.g. whether invite emails are on. */
export const useAppConfig = () =>
  api.user.getAppConfig.useQuery(undefined, { staleTime: STALE_TIME, cacheTime: Infinity }).data ??
  DEFAULT_CONFIG;
