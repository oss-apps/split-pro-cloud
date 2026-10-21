import { isSameDay, isToday, isYesterday } from 'date-fns';
import { Stack } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { formatShortDate } from '~/utils/dates';

import { type ActivityEntry, ActivityItem } from '@/components/activity/ActivityItem';
import { AddExpenseAction, EXPENSE_ICON_SIZE, useCurrentUser } from '@/components/expense';
import {
  EmptyState,
  FullScreenSpinner,
  InsetStickyHeader,
  Separator,
  Text,
  icons,
  rowInset,
} from '@/components/ui';
import { getDeviceLocale } from '@/i18n';
import { api } from '@/lib/api';
import { colors, layout, spacing } from '@/theme/tokens';

type ActivitySection = { key: string; title: string; data: ActivityEntry[] };

const matches = (entry: ActivityEntry, query: string) => {
  const { expense } = entry;
  return [
    expense.name,
    expense.group?.name,
    expense.paidByUser.name,
    expense.paidByUser.email,
    expense.deletedByUser?.name,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
};

/**
 * Port of the web's src/pages/activity.tsx: every expense the user is part of, newest first,
 * grouped by the day it was added under sticky headers, like Mail. The API returns the whole
 * list, so there's no paging and search filters on the device.
 */
const Activity = () => {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const expensesQuery = api.user.getAllExpenses.useQuery();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const query = search.trim().toLocaleLowerCase();

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    expensesQuery.refetch().finally(() => setRefreshing(false));
  }, [expensesQuery]);

  const sections = useMemo(() => {
    const now = new Date();
    const dayTitle = (date: Date) => {
      if (isToday(date)) {
        return t('activity.today');
      }

      if (isYesterday(date)) {
        return t('activity.yesterday');
      }

      return formatShortDate(date, now, getDeviceLocale());
    };
    const entries = expensesQuery.data ?? [];
    const filtered = query ? entries.filter((entry) => matches(entry, query)) : entries;

    return filtered.reduce<ActivitySection[]>((result, entry) => {
      const { createdAt } = entry.expense;
      const last = result[result.length - 1];

      if (last && last.data[0] && isSameDay(last.data[0].expense.createdAt, createdAt)) {
        last.data.push(entry);
        return result;
      }

      result.push({ key: createdAt.toISOString(), title: dayTitle(createdAt), data: [entry] });
      return result;
    }, []);
  }, [expensesQuery.data, query, t]);

  const empty = (() => {
    if (expensesQuery.isLoading || !user) {
      return <FullScreenSpinner />;
    }

    if (expensesQuery.isError) {
      return (
        <EmptyState
          icon={icons.error}
          title={t('activity.load_failed')}
          description={expensesQuery.error.message}
          actionLabel={t('common.retry')}
          onAction={() => void expensesQuery.refetch()}
        />
      );
    }

    if (query) {
      return (
        <EmptyState
          icon={icons.search}
          title={t('activity.no_results')}
          description={t('activity.no_results_description', { query: search.trim() })}
        />
      );
    }

    return <EmptyState icon={icons.activity} title={t('activity.empty')} />;
  })();

  return (
    // No wrapping view: the list must be the screen's first view for the large title to collapse.
    <>
      <SectionList
        sections={user ? sections : []}
        keyExtractor={(entry) => entry.expenseId}
        // Scrolls under the transparent header and collapses the large title.
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        style={styles.screen}
        // InsetStickyHeader pins below the navigation bar, which the search bar hides while it's
        // active; results scroll with their headers instead, like Mail's.
        stickySectionHeadersEnabled={!isSearching}
        StickyHeaderComponent={InsetStickyHeader}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text variant="headline" accessibilityRole="header">
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) =>
          user ? (
            <ActivityItem
              entry={item}
              currentUserId={user.id}
              showDate={!isSameDay(item.expense.expenseDate, item.expense.createdAt)}
            />
          ) : null
        }
        ItemSeparatorComponent={() => <Separator inset={rowInset(EXPENSE_ICON_SIZE)} />}
        ListEmptyComponent={empty}
        contentContainerStyle={sections.length ? styles.list : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      />
      <Stack.SearchBar
        placeholder={t('activity.search_placeholder')}
        onChangeText={(event) => setSearch(event.nativeEvent.text)}
        onFocus={() => setIsSearching(true)}
        onCancelButtonPress={() => {
          setSearch('');
          setIsSearching(false);
        }}
      />
      <AddExpenseAction />
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
  sectionHeader: {
    backgroundColor: colors.background,
    paddingHorizontal: layout.rowPadding,
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
});

export default Activity;
