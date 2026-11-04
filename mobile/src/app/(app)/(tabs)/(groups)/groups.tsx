import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet } from 'react-native';

import { AddExpenseAction } from '@/components/expense';
import { GroupBalanceRow } from '@/components/group/GroupBalanceRow';
import { EmptyState, FullScreenSpinner, Separator, icons, rowInset } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, layout, spacing } from '@/theme/tokens';

const openCreateGroup = () => router.push('/groups/new');

/** Every group you're in with your balance in it, like the web's src/pages/groups.tsx. */
const Groups = () => {
  const { t } = useTranslation();
  const groupsQuery = api.group.getAllGroupsWithBalances.useQuery();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    groupsQuery.refetch().finally(() => setRefreshing(false));
  }, [groupsQuery]);

  const groups = groupsQuery.data ?? [];

  const empty = (() => {
    if (groupsQuery.isLoading) {
      return <FullScreenSpinner />;
    }

    if (groupsQuery.isError && !groupsQuery.data) {
      return (
        <EmptyState
          icon={icons.error}
          title={t('groups.load_error')}
          description={groupsQuery.error.message}
          actionLabel={t('common.retry')}
          onAction={() => void groupsQuery.refetch()}
        />
      );
    }

    return (
      <EmptyState
        icon={icons.groups}
        title={t('screens.groups_empty')}
        description={t('groups.empty_description')}
        actionLabel={t('groups.create_group')}
        onAction={openCreateGroup}
      />
    );
  })();

  return (
    // No wrapping view: the list must be the screen's first view for the large title to collapse.
    <>
      <FlatList
        data={groups}
        keyExtractor={(group) => String(group.id)}
        // Scrolls under the transparent header and collapses the large title.
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
        renderItem={({ item }) => <GroupBalanceRow group={item} />}
        ItemSeparatorComponent={() => <Separator inset={rowInset(layout.rowAvatar)} />}
        ListEmptyComponent={empty}
        contentContainerStyle={groups.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <AddExpenseAction
        actions={[
          {
            label: t('groups.create_group'),
            icon: icons.groupAdd,
            onPress: openCreateGroup,
          },
        ]}
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

export default Groups;
