import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { stackScreenOptions, tabRootOptions } from '@/theme/navigation';

const BalancesLayout = () => {
  const { t } = useTranslation();

  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="balances" options={{ ...tabRootOptions, title: t('tabs.balances') }} />
    </Stack>
  );
};

export default BalancesLayout;
