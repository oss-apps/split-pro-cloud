import { NativeTabs } from 'expo-router/native-tabs';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { icons } from '@/components/ui';
import { colors } from '@/theme/tokens';

/**
 * The system tab bar: UITabBar on iOS (Liquid Glass on iOS 26), Material navigation bar on
 * Android. Each tab is a group with its own native stack, for the large-title header. "Add expense"
 * isn't a tab: it's the "+" in each tab's navigation bar (a FAB on Android), see AddExpenseAction.
 */
const TabsLayout = () => {
  const { t } = useTranslation();

  return (
    <NativeTabs tintColor={colors.tint}>
      <NativeTabs.Trigger name="(balances)">
        <NativeTabs.Trigger.Icon
          sf={{ default: icons.balances.ios, selected: icons.balancesSelected.ios }}
          md={icons.balances.android}
        />
        <NativeTabs.Trigger.Label>{t('tabs.balances')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(groups)">
        <NativeTabs.Trigger.Icon
          sf={{ default: icons.groups.ios, selected: icons.groupsSelected.ios }}
          md={icons.groups.android}
        />
        <NativeTabs.Trigger.Label>{t('tabs.groups')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(activity)">
        <NativeTabs.Trigger.Icon sf={icons.activity.ios} md={icons.activity.android} />
        <NativeTabs.Trigger.Label>{t('tabs.activity')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Icon
          sf={{ default: icons.account.ios, selected: icons.accountSelected.ios }}
          md={icons.account.android}
        />
        <NativeTabs.Trigger.Label>{t('tabs.account')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
};

export default TabsLayout;
