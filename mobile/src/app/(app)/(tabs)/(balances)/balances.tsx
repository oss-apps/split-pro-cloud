import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, Share, StyleSheet } from 'react-native';

import { AddExpenseAction } from '@/components/expense';
import { BalanceTotals } from '@/components/friend/BalanceTotals';
import { FriendBalanceRow } from '@/components/friend/FriendBalanceRow';
import { EmptyState, FullScreenSpinner, Separator, icons, rowInset } from '@/components/ui';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { colors, layout, spacing } from '@/theme/tokens';

/** Port of the web's src/pages/balances.tsx: totals, then one row per friend with a balance. */
const Balances = () => {
  const { t } = useTranslation();
  const balanceQuery = api.user.getBalances.useQuery();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    balanceQuery.refetch().finally(() => setRefreshing(false));
  }, [balanceQuery]);

  const shareApp = useCallback(() => {
    Share.share({
      title: t('balances.share_title'),
      message: `${t('balances.share_message')} ${API_URL}`,
      url: API_URL,
    }).catch(console.warn);
  }, [t]);

  const data = balanceQuery.data;

  const empty = (() => {
    if (balanceQuery.isLoading) {
      return <FullScreenSpinner />;
    }

    if (balanceQuery.isError || !data) {
      return (
        <EmptyState
          icon={icons.error}
          title={t('balances.load_error')}
          description={balanceQuery.error?.message}
          actionLabel={t('common.retry')}
          onAction={() => void balanceQuery.refetch()}
        />
      );
    }

    return (
      <EmptyState
        icon={icons.scale}
        title={t('balances.empty_title')}
        description={t('balances.empty_description')}
        actionLabel={t('balances.add_expense')}
        onAction={() => router.push('/add')}
      />
    );
  })();

  // The list is always rendered, also while loading: the navigation bar tracks the scroll view
  // it finds when the screen appears, to collapse the large title.
  const body = (
    <FlatList
      data={data?.balances ?? []}
      keyExtractor={(item) => String(item.friendId)}
      // Scrolls under the transparent header and collapses the large title.
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      renderItem={({ item }) => (
        <FriendBalanceRow
          friend={item.friend}
          amount={item.amount}
          currency={item.currency}
          hasMore={item.hasMore}
          friendId={item.friendId}
          accessory="chevron"
          onPress={() =>
            router.push({
              pathname: '/balances/[friendId]',
              params: { friendId: String(item.friendId) },
            })
          }
        />
      )}
      ItemSeparatorComponent={() => <Separator inset={rowInset(layout.rowAvatar)} />}
      ListHeaderComponent={
        data ? <BalanceTotals youOwe={data.youOwe} youGet={data.youGet} /> : undefined
      }
      ListEmptyComponent={empty}
      contentContainerStyle={data?.balances.length ? styles.list : styles.emptyList}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );

  return (
    // No wrapping view: the list must be the screen's first view for the large title to collapse.
    <>
      {body}
      <AddExpenseAction
        actions={[{ label: t('balances.share_app'), icon: icons.share, onPress: shareApp }]}
      />
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    paddingBottom: spacing[12],
  },
  emptyList: {
    flexGrow: 1,
  },
});

export default Balances;
