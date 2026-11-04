import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { hasPendingLink } from '@/lib/pendingLink';
import { configurePushHandler, getPushRoute, isPushSupported, syncPush } from '@/lib/push';
import { useAuthStore } from '@/store/authStore';

configurePushHandler();

/**
 * Notifications already opened. The tap that launched the app can come both as the last response
 * and through the listener.
 */
const openedNotifications = new Set<string>();

/** Marks the notification as handled, and whether it was new. */
const markOpened = (response: Notifications.NotificationResponse) => {
  const { identifier } = response.notification.request;
  Notifications.clearLastNotificationResponse();

  if (openedNotifications.has(identifier)) {
    return false;
  }

  openedNotifications.add(identifier);
  return true;
};

const openNotification = (response: Notifications.NotificationResponse) => {
  if (!markOpened(response)) {
    return;
  }

  const route = getPushRoute(response.notification.request.content.data?.url);

  if (route) {
    router.push(route);
  }
};

/**
 * Push for the signed-in app: keeps this device registered, opens the screen a notification points
 * to (also when it launched the app), and refreshes data when one arrives in the foreground. Mount
 * once, in the signed-in layout, before useOpenPendingLink.
 */
export const usePushNotifications = () => {
  const sessionToken = useAuthStore((state) => state.token);
  const utils = api.useUtils();

  useEffect(() => {
    if (!sessionToken || !isPushSupported()) {
      return;
    }

    syncPush(sessionToken).catch(console.warn);
  }, [sessionToken]);

  useEffect(() => {
    if (!isPushSupported()) {
      return;
    }

    const launchResponse = Notifications.getLastNotificationResponse();

    // A link opened while signed out came after the notification that launched the app, and
    // useOpenPendingLink opens it instead.
    if (launchResponse && hasPendingLink()) {
      markOpened(launchResponse);
    } else if (launchResponse) {
      openNotification(launchResponse);
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isPushSupported()) {
      return;
    }

    const subscription = Notifications.addNotificationReceivedListener(() => {
      void utils.invalidate();
    });
    return () => subscription.remove();
  }, [utils]);
};
