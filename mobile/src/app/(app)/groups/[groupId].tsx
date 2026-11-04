import { Stack, router, useIsPreview } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { isNewMonth } from '~/utils/dates';
import { getNetForUser } from '~/utils/expenseLabels';

import {
  EXPENSE_ICON_SIZE,
  ExpenseListItem,
  MonthHeader,
  useCurrentUser,
} from '@/components/expense';
import { GroupStatsSheet } from '@/components/group/GroupStatsSheet';
import { GroupBalances, GroupSummary } from '@/components/group/GroupSummary';
import { NoMembers } from '@/components/group/NoMembers';
import { shareInviteLink } from '@/components/group/invite';
import {
  retryGroupQuery,
  useGroupDetails,
  useGroupIdParam,
} from '@/components/group/useGroupDetails';
import { useGroupExit } from '@/components/group/useGroupExit';
import {
  EmptyState,
  FullScreenSpinner,
  HeaderActions,
  QuickActions,
  Screen,
  SectionCell,
  Spinner,
  icons,
  rowInset,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

type Expense = RouterOutputs['group']['getExpenses'][number];

/** A group's balances and expenses, like the web's src/pages/groups/[groupId].tsx. */
const GroupDetail = () => {
  const { t } = useTranslation();
  const groupId = useGroupIdParam();
  const user = useCurrentUser();
  const [statsOpen, setStatsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { query: groupQuery, group, notFound } = useGroupDetails(groupId);
  const expensesQuery = api.group.getExpenses.useQuery(
    { groupId },
    { enabled: Number.isInteger(groupId), retry: retryGroupQuery },
  );
  const exit = useGroupExit(group, user?.id);
  // A long-pressed row in the Groups tab shows this screen as a preview, which has no header.
  const isPreview = useIsPreview();

  const expenses = useMemo(() => expensesQuery.data ?? [], [expensesQuery.data]);
  // One inset-grouped section per month, like a statement.
  const sections = useMemo(
    () =>
      expenses.reduce<{ key: string; date: Date; data: Expense[] }[]>((result, expense, index) => {
        const previous = expenses[index - 1];
        const last = result[result.length - 1];

        if (!last || isNewMonth(expense.expenseDate, previous?.expenseDate)) {
          result.push({ key: expense.id, date: expense.expenseDate, data: [expense] });
        } else {
          last.data.push(expense);
        }

        return result;
      }, []),
    [expenses],
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([groupQuery.refetch(), expensesQuery.refetch()]).finally(() =>
      setRefreshing(false),
    );
  }, [groupQuery, expensesQuery]);

  const params = { groupId: String(groupId) };

  const header = isPreview ? null : (
    <>
      <Stack.Screen options={{ title: group?.name ?? t('screens.group') }} />
      {group ? (
        <HeaderActions
          actions={[
            {
              label: t('common.more'),
              icon: icons.more,
              loading: exit.loading,
              menu: [
                {
                  label: t('groups.info'),
                  icon: icons.infoOutline,
                  onPress: () => router.push({ pathname: '/groups/[groupId]/info', params }),
                },
                {
                  label: t('groups.stats'),
                  icon: icons.stats,
                  onPress: () => setStatsOpen(true),
                },
                {
                  label: t('groups.add_members'),
                  icon: icons.groupAdd,
                  onPress: () => router.push({ pathname: '/groups/[groupId]/add-members', params }),
                },
                {
                  label: t('groups.share_invite_link'),
                  icon: icons.share,
                  onPress: () => void shareInviteLink(group, t),
                },
                {
                  items: [
                    {
                      label: exit.label,
                      icon: exit.icon,
                      destructive: true,
                      onPress: exit.onPress,
                    },
                  ],
                },
              ],
            },
          ]}
        />
      ) : null}
    </>
  );

  if (notFound || (!group && groupQuery.isError)) {
    return (
      <Screen edges={[]} background="grouped">
        {header}
        <EmptyState
          icon={notFound ? icons.groups : icons.error}
          title={notFound ? t('groups.not_found') : t('groups.group_load_error')}
          description={notFound ? t('groups.not_found_description') : groupQuery.error?.message}
          actionLabel={notFound ? undefined : t('common.retry')}
          onAction={notFound ? undefined : onRefresh}
        />
      </Screen>
    );
  }

  if (!group || !user) {
    return (
      <>
        {header}
        <FullScreenSpinner grouped />
      </>
    );
  }

  const members = group.groupUsers.map((groupUser) => groupUser.user);
  const hasNoMembers =
    1 === group.groupUsers.length && !expensesQuery.isLoading && !expenses.length;

  const listHeader = (
    <View style={styles.header}>
      <GroupSummary name={group.name} userId={user.id} groupBalances={group.groupBalances} />
      <View style={styles.actions}>
        <QuickActions
          actions={[
            {
              label: t('groups.add_expense'),
              icon: icons.add,
              onPress: () => router.push({ pathname: '/add', params }),
            },
            {
              label: t('groups.settle_up'),
              icon: icons.settle,
              onPress: () => router.push({ pathname: '/settle-up', params }),
            },
            {
              label: t('groups.invite'),
              icon: icons.share,
              onPress: () => void shareInviteLink(group, t),
            },
          ]}
        />
      </View>
      {/* One child each, so the header's `gap` doesn't add to the sections' own spacing */}
      <View>
        {hasNoMembers ? <NoMembers group={group} /> : null}
        <GroupBalances userId={user.id} groupBalances={group.groupBalances} members={members} />
      </View>
    </View>
  );

  const empty = (() => {
    if (hasNoMembers) {
      return null;
    }

    if (expensesQuery.isLoading) {
      return (
        <View style={styles.loading}>
          <Spinner />
        </View>
      );
    }

    if (expensesQuery.isError) {
      return (
        <EmptyState
          icon={icons.error}
          title={t('groups.group_load_error')}
          description={expensesQuery.error.message}
          actionLabel={t('common.retry')}
          onAction={() => void expensesQuery.refetch()}
        />
      );
    }

    return (
      <EmptyState
        icon={icons.receipt}
        title={t('groups.no_expenses')}
        description={t('groups.no_expenses_description')}
        actionLabel={t('groups.add_expense')}
        onAction={() => router.push({ pathname: '/add', params })}
      />
    );
  })();

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
              currentUserId={user.id}
              paidBy={item.paidByUser}
              receiver={
                'SETTLEMENT' === item.splitType
                  ? item.expenseParticipants.find(
                      (participant) => participant.userId !== item.paidBy,
                    )?.user
                  : undefined
              }
              net={getNetForUser(item, user.id)}
            />
          </SectionCell>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <GroupStatsSheet
        groupId={groupId}
        firstExpenseAt={expenses[expenses.length - 1]?.createdAt}
        visible={statsOpen}
        onClose={() => setStatsOpen(false)}
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
    flexGrow: 1,
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
  loading: {
    paddingVertical: spacing[8],
    alignItems: 'center',
  },
});

export default GroupDetail;
