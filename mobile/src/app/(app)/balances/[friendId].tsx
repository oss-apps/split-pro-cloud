import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { isNewMonth } from '~/utils/dates';
import { getNetWithFriend, hasShareWithFriend } from '~/utils/expenseLabels';
import { getSettleableCurrencies } from '~/utils/settleUp';

import {
  EXPENSE_ICON_SIZE,
  ExpenseListItem,
  MonthHeader,
  useCurrentUser,
} from '@/components/expense';
import { buildFriendExpensesCsv, shareCsv } from '@/components/friend/exportCsv';
import { BalanceBreakdown, FriendSummary } from '@/components/friend/FriendSummary';
import {
  EmptyState,
  FullScreenSpinner,
  HeaderActions,
  QuickActions,
  Screen,
  SectionCell,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { confirmAction, showMessage } from '@/lib/dialogs';
import { goBackOr } from '@/lib/navigation';
import { colors, spacing } from '@/theme/tokens';

/** Port of the web's src/pages/balances/[friendId].tsx. */
const FriendBalance = () => {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ friendId: string }>();
  const friendId = Number(params.friendId);
  const enabled = Number.isInteger(friendId) && 0 < friendId;
  const currentUser = useCurrentUser();
  const utils = api.useUtils();

  const friendQuery = api.user.getFriend.useQuery({ friendId }, { enabled });
  const expensesQuery = api.user.getExpensesWithFriend.useQuery({ friendId }, { enabled });
  const balancesQuery = api.user.getBalancesWithFriend.useQuery({ friendId }, { enabled });
  const breakdownQuery = api.user.getBalanceBreakdownWithFriend.useQuery({ friendId }, { enabled });
  const deleteFriendMutation = api.user.deleteFriend.useMutation();

  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const friend = friendQuery.data;
  const friendName = friend?.name ?? friend?.email ?? '';
  const expenses = useMemo(() => expensesQuery.data ?? [], [expensesQuery.data]);
  const balances = balancesQuery.data ?? [];
  // The export keeps every expense; the list skips those where neither owes the other anything.
  const listedExpenses = useMemo(
    () =>
      currentUser
        ? expenses.filter((expense) => hasShareWithFriend(expense, currentUser.id, friendId))
        : [],
    [currentUser, expenses, friendId],
  );
  // One inset-grouped section per month, like a statement.
  const sections = useMemo(
    () =>
      listedExpenses.reduce<{ key: string; date: Date; data: typeof listedExpenses }[]>(
        (result, expense, index) => {
          const previous = listedExpenses[index - 1];
          const last = result[result.length - 1];

          if (!last || isNewMonth(expense.expenseDate, previous?.expenseDate)) {
            result.push({ key: expense.id, date: expense.expenseDate, data: [expense] });
          } else {
            last.data.push(expense);
          }

          return result;
        },
        [],
      ),
    [listedExpenses],
  );
  const canSettle = 0 < getSettleableCurrencies(breakdownQuery.data ?? []).length;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([
      friendQuery.refetch(),
      expensesQuery.refetch(),
      balancesQuery.refetch(),
      breakdownQuery.refetch(),
    ]).finally(() => setRefreshing(false));
  }, [friendQuery, expensesQuery, balancesQuery, breakdownQuery]);

  const removeFriend = useCallback(async () => {
    try {
      await deleteFriendMutation.mutateAsync({ friendId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('balances.friend.remove_failed'));
      return;
    }

    toast.success(t('balances.friend.removed', { name: friendName }));
    utils.user.invalidate().catch(console.error);
    goBackOr();
  }, [deleteFriendMutation, friendId, friendName, t, utils]);

  const confirmRemove = useCallback(() => {
    // Same rule as the server: only friends without outstanding balances can be removed.
    if (balances.length) {
      showMessage(
        t('balances.friend.remove_blocked_title'),
        t('balances.friend.remove_blocked'),
        t('balances.ok'),
      );
      return;
    }

    confirmAction({
      title: t('balances.friend.remove_confirm_title'),
      message: t('balances.friend.remove_confirm', { name: friendName }),
      confirmLabel: t('balances.friend.remove_action'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => void removeFriend(),
    });
  }, [balances.length, friendName, removeFriend, t]);

  const exportExpenses = useCallback(async () => {
    if (!currentUser) {
      return;
    }

    setExporting(true);
    try {
      const csv = buildFriendExpensesCsv({
        expenses,
        currentUserId: currentUser.id,
        friendId,
        friendName,
      });
      const shared = await shareCsv(
        csv,
        t('balances.friend.export_file_name', { name: friendName }),
        t('balances.friend.export_title', { name: friendName }),
      );
      if (!shared) {
        toast.error(t('balances.friend.export_unavailable'));
      }
    } catch (error) {
      console.error(error);
      toast.error(t('balances.friend.export_failed'));
    } finally {
      setExporting(false);
    }
  }, [currentUser, expenses, friendId, friendName, t]);

  const header = (
    <>
      <Stack.Screen options={{ title: friendName || t('screens.friend_balance') }} />
      {friend ? (
        <HeaderActions
          actions={[
            {
              label: t('common.more'),
              icon: icons.more,
              loading: deleteFriendMutation.isLoading,
              menu: [
                {
                  label: t('balances.friend.remove'),
                  icon: icons.trash,
                  destructive: true,
                  onPress: confirmRemove,
                },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );

  const isLoading =
    friendQuery.isLoading || expensesQuery.isLoading || balancesQuery.isLoading || !currentUser;

  if (!enabled || (!isLoading && !friendQuery.isError && !friend)) {
    return (
      <Screen edges={[]} background="grouped">
        {header}
        <EmptyState
          icon={icons.personMissing}
          title={t('balances.friend.not_found')}
          description={t('balances.friend.not_found_description')}
        />
      </Screen>
    );
  }

  if (friendQuery.isError || expensesQuery.isError || balancesQuery.isError) {
    return (
      <Screen edges={[]} background="grouped">
        {header}
        <EmptyState
          icon={icons.error}
          title={t('balances.friend.load_error')}
          description={(friendQuery.error ?? expensesQuery.error ?? balancesQuery.error)?.message}
          actionLabel={t('common.retry')}
          onAction={onRefresh}
        />
      </Screen>
    );
  }

  if (isLoading || !friend || !currentUser) {
    return (
      <>
        {header}
        <FullScreenSpinner grouped />
      </>
    );
  }

  return (
    <>
      {header}
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(expense) => expense.id}
        // Scrolls under the transparent header.
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <MonthHeader date={section.date} />}
        renderItem={({ item, index, section }) => (
          <SectionCell
            first={0 === index}
            last={index === section.data.length - 1}
            separatorInset={rowInset(EXPENSE_ICON_SIZE)}
          >
            <ExpenseListItem
              expense={item}
              currentUserId={currentUser.id}
              paidBy={item.paidBy === currentUser.id ? currentUser : friend}
              groupName={item.group?.name}
              net={getNetWithFriend(item, currentUser.id, friendId)}
            />
          </SectionCell>
        )}
        ListHeaderComponent={
          <View style={styles.header}>
            <FriendSummary friend={friend} balances={balances} />
            <View style={styles.actions}>
              <QuickActions
                actions={[
                  {
                    label: t('balances.friend.settle_up'),
                    icon: icons.settle,
                    disabled: !canSettle,
                    onPress: () =>
                      router.push({
                        pathname: '/settle-up',
                        params: { friendId: String(friendId) },
                      }),
                  },
                  {
                    label: t('balances.friend.add_expense'),
                    icon: icons.add,
                    onPress: () =>
                      router.push({ pathname: '/add', params: { friendId: String(friendId) } }),
                  },
                  {
                    label: t('balances.friend.export'),
                    icon: icons.export,
                    disabled: !expenses.length,
                    loading: exporting,
                    onPress: () => void exportExpenses(),
                  },
                ]}
              />
            </View>
            {breakdownQuery.data ? <BalanceBreakdown breakdown={breakdownQuery.data} /> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={icons.receipt}
            title={t('balances.friend.no_expenses')}
            description={t('balances.friend.no_expenses_description', { name: friendName })}
          />
        }
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
    </>
  );
};

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    paddingBottom: spacing[12],
  },
  header: {
    gap: spacing[5],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
  },
  actions: {
    paddingHorizontal: spacing[4],
  },
});

export default FriendBalance;
