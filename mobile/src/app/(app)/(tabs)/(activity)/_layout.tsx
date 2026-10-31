import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { stackScreenOptions, tabRootOptions } from '@/theme/navigation';

const ActivityLayout = () => {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="activity" options={{ ...tabRootOptions, title: t('tabs.activity') }} />
    </Stack>
  );
};

export default ActivityLayout;
