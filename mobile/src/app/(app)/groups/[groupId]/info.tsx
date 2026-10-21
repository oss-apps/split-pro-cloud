import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { getPersonName, useCurrentUser } from '@/components/expense';
import { DefaultSplitSection } from '@/components/group/DefaultSplitSummary';
import { GroupRecurringRules } from '@/components/group/GroupRecurringRules';
import { useGroupDetails, useGroupIdParam } from '@/components/group/useGroupDetails';
import { useGroupExit } from '@/components/group/useGroupExit';
import {
  Avatar,
  EmptyState,
  FullScreenSpinner,
  Icon,
  ListRow,
  Screen,
  Section,
  Spinner,
  Text,
  icons,
  rowInset,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { getCurrency } from '@/lib/money';
import { colors, spacing } from '@/theme/tokens';

const MEMBER_AVATAR = 32;

/** Members, default split, recurring expenses and leave/delete, like the web's "Group info". */
const GroupInfo = () => {
  const { t } = useTranslation();
  const groupId = useGroupIdParam();
  const user = useCurrentUser();
  const utils = api.useUtils();
  const { query, group, notFound } = useGroupDetails(groupId);
  const exit = useGroupExit(group, user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([query.refetch(), utils.recurring.getGroupRules.invalidate({ groupId })]).finally(
      () => setRefreshing(false),
    );
  }, [groupId, query, utils]);

  if (notFound || (!group && query.isError)) {
    return (
      <Screen edges={[]} background="grouped">
        <EmptyState
          icon={notFound ? icons.groups : icons.error}
          title={notFound ? t('groups.not_found') : t('groups.group_load_error')}
          description={notFound ? t('groups.not_found_description') : query.error?.message}
          actionLabel={notFound ? undefined : t('common.retry')}
          onAction={notFound ? undefined : () => void query.refetch()}
        />
      </Screen>
    );
  }

  if (!group || !user) {
    return (
      <>
        <FullScreenSpinner grouped />
      </>
    );
  }

  const currencyName = getCurrency(group.defaultCurrency)?.name;

  return (
    <Screen
      edges={[]}
      background="grouped"
      scroll
      padded={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.title}>
        <Avatar name={group.name} size={72} />
        <Text variant="title2" align="center" numberOfLines={2} accessibilityRole="header">
          {group.name}
        </Text>
      </View>

      <Section header={t('groups.members')} separatorInset={rowInset(MEMBER_AVATAR)}>
        {group.groupUsers.map(({ user: member }) => (
          <ListRow
            key={member.id}
            left={
              <Avatar
                name={member.name}
                email={member.email}
                image={member.image}
                size={MEMBER_AVATAR}
              />
            }
            title={getPersonName(member)}
          />
        ))}
        <ListRow
          left={
            <View style={styles.iconSlot}>
              <Icon name={icons.groupAdd} color={colors.tint} />
            </View>
          }
          title={t('groups.add_members')}
          action
          onPress={() =>
            router.push({
              pathname: '/groups/[groupId]/add-members',
              params: { groupId: String(groupId) },
            })
          }
        />
      </Section>

      <DefaultSplitSection group={group} />

      <GroupRecurringRules groupId={groupId} />

      <Section header={t('groups.details')}>
        <ListRow
          title={t('groups.currency')}
          detail={
            currencyName ? `${group.defaultCurrency} · ${currencyName}` : group.defaultCurrency
          }
        />
        <ListRow title={t('groups.group_created')} detail={formatDate(group.createdAt)} />
      </Section>

      <Section>
        <ListRow
          title={exit.label}
          destructive
          disabled={exit.loading}
          right={exit.loading ? <Spinner /> : undefined}
          onPress={exit.onPress}
        />
      </Section>
    </Screen>
  );
};

const styles = StyleSheet.create({
  title: {
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
  },
  iconSlot: {
    width: MEMBER_AVATAR,
    alignItems: 'center',
  },
});

export default GroupInfo;
