import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { Fab, type HeaderAction, HeaderActions, icons } from '@/components/ui';

export interface AddExpenseActionProps {
  /** Other header buttons for the screen, shown before the add button. */
  actions?: HeaderAction[];
}

/**
 * "Add expense" on the tab roots, one tap away: the prominent "+" in the navigation bar on iOS,
 * an extended FAB on Android (render this as the last child of the screen's root view). Takes the
 * screen's other header buttons too, so a screen renders one `HeaderActions`.
 */
export const AddExpenseAction: React.FC<AddExpenseActionProps> = ({ actions = [] }) => {
  const { t } = useTranslation();
  const addExpense = () => router.push('/add');

  if ('ios' === Platform.OS) {
    return (
      <HeaderActions
        actions={[
          ...actions,
          {
            label: t('balances.add_expense'),
            icon: icons.add,
            variant: 'prominent',
            onPress: addExpense,
          },
        ]}
      />
    );
  }

  return (
    <>
      {actions.length ? <HeaderActions actions={actions} /> : null}
      <Fab icon={icons.add} label={t('balances.add_expense')} onPress={addExpense} />
    </>
  );
};
