import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { groupedScreenOptions, stackScreenOptions, tabRootOptions } from '@/theme/navigation';

// Edit profile, feedback and delete account are modals in (app)/_layout.tsx, over the tab bar.
const AccountLayout = () => {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="account"
        options={{ ...tabRootOptions, ...groupedScreenOptions, title: t('tabs.account') }}
      />
    </Stack>
  );
};

export default AccountLayout;
