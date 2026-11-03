import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { icons, tabIcon } from '@/components/ui';
import { tabBarOptions } from '@/theme/navigation';

/**
 * The system tab bar: UITabBar on iOS (Liquid Glass on iOS 26), Material navigation bar on
 * Android. Each tab is a group with its own native stack, for the large-title header. "Add expense"
 * isn't a tab: it's the "+" in each tab's navigation bar (a FAB on Android), see AddExpenseAction.
 */
const TabsLayout = () => {
  const { t } = useTranslation();

  return (
    <NativeTabs {...tabBarOptions}>
      <NativeTabs.Trigger name="(balances)">
        <NativeTabs.Trigger.Icon {...tabIcon(icons.balances, icons.balancesSelected)} />
        <NativeTabs.Trigger.Label>{t('tabs.balances')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(groups)">
        <NativeTabs.Trigger.Icon {...tabIcon(icons.groups, icons.groupsSelected)} />
        <NativeTabs.Trigger.Label>{t('tabs.groups')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(activity)">
        <NativeTabs.Trigger.Icon {...tabIcon(icons.activity)} />
        <NativeTabs.Trigger.Label>{t('tabs.activity')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Icon {...tabIcon(icons.account, icons.accountSelected)} />
        <NativeTabs.Trigger.Label>{t('tabs.account')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
};

export default TabsLayout;
