import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  groupedScreenOptions,
  opaqueHeaderOptions,
  stackScreenOptions,
  tabRootOptions,
} from '@/theme/navigation';

const AccountLayout = () => {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="account"
        options={{ ...tabRootOptions, ...groupedScreenOptions, title: t('tabs.account') }}
      />
      {/*
        Modal forms: Cancel on the left, the confirm action on the right. Opaque headers, as a
        transparent header in a sheet covers the top of the content on iOS.
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
    </Stack>
  );
};

export default AccountLayout;
