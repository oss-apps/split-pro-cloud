import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { stackScreenOptions, tabRootOptions } from '@/theme/navigation';

const GroupsLayout = () => {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="groups" options={{ ...tabRootOptions, title: t('tabs.groups') }} />
    </Stack>
  );
};

export default GroupsLayout;
