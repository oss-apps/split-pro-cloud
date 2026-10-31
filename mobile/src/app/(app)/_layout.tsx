import { type NativeStackNavigationOptions, Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { useOpenPendingLink } from '@/providers/usePendingLink';
import { usePushNotifications } from '@/providers/usePushNotifications';
import { groupedScreenOptions, opaqueHeaderOptions, stackScreenOptions } from '@/theme/navigation';

// A screen opened from a link at launch still has the tabs to go back to.
export const unstable_settings = {
  anchor: '(tabs)',
};

/** Signed-in screens: the tabs plus every detail screen and modal pushed on top of them. */
const AppLayout = () => {
  const { t } = useTranslation();
  usePushNotifications();
  useOpenPendingLink();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="balances/[friendId]"
        options={{ title: t('screens.friend_balance'), ...groupedScreenOptions }}
      />
      <Stack.Screen
        name="groups/[groupId]"
        options={{ title: t('screens.group'), ...groupedScreenOptions }}
      />
      <Stack.Screen
        name="groups/new"
        options={{
          presentation: 'modal',
          title: t('groups.create_title'),
          ...groupedScreenOptions,
        }}
      />
      <Stack.Screen
        name="groups/[groupId]/info"
        options={{ title: t('groups.info'), ...groupedScreenOptions }}
      />
      <Stack.Screen
        name="groups/[groupId]/add-members"
        options={{ presentation: 'modal', title: t('groups.add_members'), ...groupedScreenOptions }}
      />
      <Stack.Screen
        name="groups/[groupId]/default-split"
        options={{
          presentation: 'modal',
          title: t('groups.default_split'),
          ...groupedScreenOptions,
        }}
      />
      <Stack.Screen name="join-group" options={{ headerShown: false }} />
      <Stack.Screen
        name="expenses/[expenseId]"
        options={{ title: t('screens.expense'), ...groupedScreenOptions }}
      />
      <Stack.Screen
        name="add"
        options={{
          presentation: 'fullScreenModal',
          title: t('screens.add_expense'),
          ...groupedScreenOptions,
        }}
      />
      <Stack.Screen name="new" options={{ headerShown: false }} />
      {/*
        The account tab's forms. Opaque headers, as a transparent header in a sheet covers the top of
        the content on iOS. Here rather than in the tab's stack, so they cover the tab bar on Android.
      */}
      <Stack.Screen
        name="edit-profile"
        options={{
          ...groupedScreenOptions,
          ...opaqueHeaderOptions,
          presentation: 'modal',
          title: t('account.edit_details'),
        }}
      />
      <Stack.Screen
        name="feedback"
        options={{
          ...groupedScreenOptions,
          ...opaqueHeaderOptions,
          presentation: 'modal',
          title: t('account.feedback'),
        }}
      />
      <Stack.Screen
        name="delete-account"
        options={{
          ...groupedScreenOptions,
          ...opaqueHeaderOptions,
          presentation: 'modal',
          title: t('account.delete_account'),
        }}
      />
      <Stack.Screen
        name="settle-up"
        options={{
          // Android's form sheet is a bare bottom sheet without the native header that holds
          // Close and Save, so it's a full-screen dialog there like the other flows.
          ...Platform.select<NativeStackNavigationOptions>({
            ios: {
              presentation: 'formSheet',
              sheetAllowedDetents: [0.6, 1],
              sheetGrabberVisible: true,
            },
            default: { presentation: 'modal' },
          }),
          title: t('screens.settle_up'),
          ...groupedScreenOptions,
        }}
      />
    </Stack>
  );
};

export default AppLayout;
