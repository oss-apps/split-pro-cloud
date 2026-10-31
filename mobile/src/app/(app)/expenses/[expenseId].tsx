import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { ExpenseDetails } from '@/components/expense-detail/ExpenseDetails';
import { canDeleteExpense, canEditExpense } from '@/components/expense-detail/expenseDetail';
import {
  EmptyState,
  FullScreenSpinner,
  type HeaderAction,
  HeaderActions,
  icons,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAction } from '@/lib/dialogs';
import { haptics } from '@/lib/haptics';
import { goBackOr } from '@/lib/navigation';
import { colors } from '@/theme/tokens';

/**
 * Expense details for group and non-group expenses, like the web's /expenses/[expenseId] and
 * /groups/[groupId]/expenses/[expenseId]. `user.getExpenseDetails` lets group members see any
 * expense of their group, so the optional `groupId` param isn't needed to load it.
 */
const ExpenseDetail = () => {
  const { t } = useTranslation();
  const { expenseId } = useLocalSearchParams<{ expenseId: string; groupId?: string }>();
  const utils = api.useUtils();
  const meQuery = api.user.me.useQuery();
  const expenseQuery = api.user.getExpenseDetails.useQuery({ expenseId });
  const deleteMutation = api.user.deleteExpense.useMutation();

  const expense = expenseQuery.data;
  const userId = meQuery.data?.id;
  const canEdit = !!expense && canEditExpense(expense);
  const canDelete = !!expense && undefined !== userId && canDeleteExpense(expense, userId);

  const onDelete = () => {
    haptics.warning();
    confirmAction({
      destructive: true,
      title: t('expense.detail.delete_title'),
      message: t('expense.detail.delete_message'),
      confirmLabel: t('expense.detail.delete_confirm'),
      cancelLabel: t('common.cancel'),
      onConfirm: () =>
        deleteMutation.mutate(
          { expenseId },
          {
            onSuccess: () => {
              Promise.all([
                utils.user.invalidate(),
                utils.group.invalidate(),
                utils.recurring.invalidate(),
              ]).catch(console.error);
              toast.success(t('expense.detail.deleted'));
              goBackOr();
            },
            onError: (error) => toast.error(error.message || t('expense.detail.delete_failed')),
          },
        ),
    });
  };

  const actions: HeaderAction[] = [
    ...(canEdit
      ? [
          {
            label: t('expense.detail.edit'),
            icon: icons.edit,
            onPress: () => router.push({ pathname: '/add', params: { expenseId } }),
          },
        ]
      : []),
    ...(canDelete
      ? [
          {
            label: t('common.more'),
            icon: icons.more,
            loading: deleteMutation.isLoading,
            menu: [
              {
                label: t('expense.detail.delete'),
                icon: icons.trash,
                destructive: true,
                onPress: onDelete,
              },
            ],
          },
        ]
      : []),
  ];

  const isNotFound = 'NOT_FOUND' === expenseQuery.error?.data?.code;

  const content = (() => {
    if (expense && undefined !== userId) {
      return <ExpenseDetails expense={expense} userId={userId} />;
    }

    if (expenseQuery.isError) {
      return isNotFound ? (
        <EmptyState
          icon={icons.receipt}
          title={t('expense.detail.not_found')}
          description={t('expense.detail.not_found_description')}
        />
      ) : (
        <EmptyState
          icon={icons.error}
          title={t('expense.detail.load_failed')}
          description={expenseQuery.error.message}
          actionLabel={t('common.retry')}
          onAction={() => void expenseQuery.refetch()}
        />
      );
    }

    return <FullScreenSpinner grouped />;
  })();

  return (
    <>
      {/* Scrolls under the transparent header (overrides the layout's opaque header) */}
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl
            refreshing={expenseQuery.isRefetching}
            onRefresh={() => void expenseQuery.refetch()}
          />
        }
      >
        {content}
      </ScrollView>
      {actions.length ? <HeaderActions actions={actions} /> : null}
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    flexGrow: 1,
  },
});

export default ExpenseDetail;
