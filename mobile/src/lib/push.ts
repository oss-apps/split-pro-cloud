/**
 * Expo push notifications: permission, the device's Expo push token and registering it with the
 * API (`user.registerPushToken`). The backend sends `data.url` with a web-style path such as
 * `/expenses/123`; `getPushRoute` maps it to an app route.
 *
 * Push only works in a native build on a real device. On web and simulators every call here is a
 * no-op that reports `unsupported`.
 */
import { createTRPCProxyClient, httpLink } from '@trpc/client';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { type Href } from 'expo-router';
import { Platform } from 'react-native';
import superjson from 'superjson';

import type { AppRouter } from '~/server/api/root';

import { API_URL } from './config';
import { storage } from './storage';

/** The token this device registered with the server, so it can be unregistered at sign-out. */
const TOKEN_KEY = 'splitpro.pushToken';
/** Set when the user turned notifications off in the app, so we don't re-register on launch. */
const OPTED_OUT_KEY = 'splitpro.pushOptedOut';
/** Set once we asked for permission, so the post-expense prompt only shows once. */
const ASKED_KEY = 'splitpro.pushAsked';

export const ANDROID_CHANNEL_ID = 'default';

export type PushState = 'unsupported' | 'undetermined' | 'denied' | 'disabled' | 'enabled';

/** `unavailable` means the build has no EAS project id, so there is no Expo push token. */
export type EnablePushResult = 'enabled' | 'denied' | 'unsupported' | 'unavailable';

export const isPushSupported = () =>
  ('ios' === Platform.OS || 'android' === Platform.OS) && Device.isDevice;

const getProjectId = (): string | undefined => {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const projectId = Constants.easConfig?.projectId ?? extra?.eas?.projectId;
  return 'string' === typeof projectId && projectId ? projectId : undefined;
};

/**
 * A tRPC client with an explicit session token. Push calls happen outside React and must use the
 * token they were started with, not whatever the store holds by then.
 */
const createClient = (sessionToken: string) =>
  createTRPCProxyClient<AppRouter>({
    transformer: superjson as unknown as AppRouter['_def']['_config']['transformer'],
    links: [
      httpLink({
        url: `${API_URL}/api/trpc`,
        headers: () => ({ Authorization: `Bearer ${sessionToken}` }),
      }),
    ],
  });

const readFlag = async (key: string) => '1' === (await storage.getItem(key));

const setFlag = (key: string, value: boolean) =>
  value ? storage.setItem(key, '1') : storage.removeItem(key);

/** Shows notifications as banners while the app is open too. Call once at startup. */
export const configurePushHandler = () => {
  if (!isPushSupported()) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
};

/** Android 13+ only shows the permission prompt once a channel exists. */
const ensureAndroidChannel = async () => {
  if ('android' !== Platform.OS) {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'default',
    importance: AndroidImportance.HIGH,
  });
};

export const getPushState = async (): Promise<PushState> => {
  if (!isPushSupported()) {
    return 'unsupported';
  }

  const permission = await Notifications.getPermissionsAsync();

  if (!permission.granted) {
    return permission.canAskAgain ? 'undetermined' : 'denied';
  }

  const [token, optedOut] = await Promise.all([
    storage.getItem(TOKEN_KEY),
    readFlag(OPTED_OUT_KEY),
  ]);

  return token && !optedOut ? 'enabled' : 'disabled';
};

const registerDevice = async (sessionToken: string) => {
  const projectId = getProjectId();

  if (!projectId) {
    return false;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  const previous = await storage.getItem(TOKEN_KEY);
  const client = createClient(sessionToken);

  if (previous && previous !== token) {
    await client.user.unregisterPushToken.mutate({ token: previous }).catch(console.warn);
  }

  await client.user.registerPushToken.mutate({
    token,
    platform: 'ios' === Platform.OS ? 'ios' : 'android',
    deviceName: (Device.deviceName ?? Device.modelName)?.slice(0, 100) ?? null,
  });
  await storage.setItem(TOKEN_KEY, token);
  return true;
};

/** Asks for permission if needed, then registers this device. Throws if the server call fails. */
export const enablePush = async (sessionToken: string): Promise<EnablePushResult> => {
  if (!isPushSupported()) {
    return 'unsupported';
  }

  await ensureAndroidChannel();

  let permission = await Notifications.getPermissionsAsync();

  if (!permission.granted && permission.canAskAgain) {
    await setFlag(ASKED_KEY, true);
    permission = await Notifications.requestPermissionsAsync();
  }

  if (!permission.granted) {
    return 'denied';
  }

  if (!(await registerDevice(sessionToken))) {
    return 'unavailable';
  }

  await setFlag(OPTED_OUT_KEY, false);
  return 'enabled';
};

/** Stops notifications to this device for the signed-in user. Permission stays as it is. */
export const disablePush = async (sessionToken: string) => {
  if (!isPushSupported()) {
    return;
  }

  const token = await storage.getItem(TOKEN_KEY);

  if (token) {
    await createClient(sessionToken).user.unregisterPushToken.mutate({ token });
  }

  await storage.removeItem(TOKEN_KEY);
  await setFlag(OPTED_OUT_KEY, true);
};

/**
 * Re-registers on launch when notifications are on, since the Expo token can change and another
 * account may have taken it over. Never prompts.
 */
export const syncPush = async (sessionToken: string) => {
  if (!isPushSupported() || (await readFlag(OPTED_OUT_KEY))) {
    return;
  }

  const permission = await Notifications.getPermissionsAsync();

  if (!permission.granted) {
    return;
  }

  await ensureAndroidChannel();
  await registerDevice(sessionToken);
};

/**
 * Whether to offer notifications after an expense: on a device, while the permission was never
 * asked for, and only until the user answered once (`markPushOffered`).
 */
export const shouldOfferPush = async () => {
  if (!isPushSupported()) {
    return false;
  }

  const [asked, optedOut, permission] = await Promise.all([
    readFlag(ASKED_KEY),
    readFlag(OPTED_OUT_KEY),
    Notifications.getPermissionsAsync(),
  ]);

  return !asked && !optedOut && !permission.granted && permission.canAskAgain;
};

/** Remembers that the user answered the offer, whatever the answer. */
export const markPushOffered = () => setFlag(ASKED_KEY, true);

/** The token this device registered, sent with sign-out so the server stops using it. */
export const getRegisteredPushToken = () => storage.getItem(TOKEN_KEY);

/**
 * Forgets the registered token once signed out. Keeps the opt-out choice, so the next sign-in on
 * this device registers again only if notifications were on.
 */
export const forgetRegisteredPushToken = () => storage.removeItem(TOKEN_KEY);

const PUSH_ROUTES: { pattern: RegExp; route: (id: string) => string }[] = [
  // The web's group expense URL, in case a payload uses it.
  { pattern: /^\/groups\/\d+\/expenses\/([\w-]+)$/, route: (id) => `/expenses/${id}` },
  { pattern: /^\/expenses\/([\w-]+)$/, route: (id) => `/expenses/${id}` },
  { pattern: /^\/groups\/(\d+)$/, route: (id) => `/groups/${id}` },
  { pattern: /^\/balances\/(\d+)$/, route: (id) => `/balances/${id}` },
  { pattern: /^\/(activity|groups|balances|account)$/, route: (tab) => `/${tab}` },
];

/** The app route for a notification's `data.url`, or `null` for anything we don't know. */
export const getPushRoute = (url: unknown): Href | null => {
  if ('string' !== typeof url) {
    return null;
  }

  // Accept full URLs too (https://splitpro.app/groups/5) and drop any query string.
  const path = url
    .replace(/^[a-z]+:\/\/[^/]+/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

  const match = PUSH_ROUTES.map(({ pattern, route }) => {
    const id = pattern.exec(path)?.[1];
    return id ? route(id) : null;
  }).find(Boolean);

  return (match ?? null) as Href | null;
};
