import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import {
  Avatar,
  EmptyState,
  Icon,
  ListRow,
  Section,
  Skeleton,
  Text,
  icons,
  rowInset,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { useAppConfig } from '@/lib/appConfig';
import { haptics } from '@/lib/haptics';
import { useAddExpenseStore } from '@/store/addExpenseStore';
import { colors, layout, spacing } from '@/theme/tokens';

import { useInviteFriend } from './useInviteFriend';

type GroupWithMembers = RouterOutputs['group']['getAllGroups'][number]['group'];

const AVATAR_SIZE = 36;

const LoadingRows = () => (
  <Section separatorInset={rowInset(AVATAR_SIZE)}>
    {[0, 1, 2].map((key) => (
      <View key={key} style={styles.loadingRow}>
        <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={AVATAR_SIZE / 2} />
        <Skeleton width="55%" height={16} />
      </View>
    ))}
  </Section>
);

/**
 * Friends and groups to split with, filtered by what was typed, like the suggestions under Mail's
 * "To:" field. Port of the web's SelectUserOrGroup.
 */
export const SelectUserOrGroup: React.FC = () => {
  const { t } = useTranslation();
  const nameOrEmail = useAddExpenseStore((s) => s.nameOrEmail);
  const participants = useAddExpenseStore((s) => s.participants);
  const group = useAddExpenseStore((s) => s.group);
  const { addOrUpdateParticipant, removeParticipant, setNameOrEmail, selectGroup } =
    useAddExpenseStore((s) => s.actions);
  const invite = useInviteFriend();
  const { invitesEnabled } = useAppConfig();

  const friendsQuery = api.user.getFriends.useQuery();
  const groupsQuery = api.group.getAllGroups.useQuery();

  const email = nameOrEmail.trim();
  const isEmail = z.string().email().safeParse(email).success;
  const search = nameOrEmail.toLowerCase();

  const friends = useMemo(
    () =>
      friendsQuery.data?.filter((friend) =>
        (friend.name ?? friend.email)?.toLowerCase().includes(search),
      ),
    [friendsQuery.data, search],
  );
  const groups = useMemo(
    () => groupsQuery.data?.filter((entry) => entry.group.name.toLowerCase().includes(search)),
    [groupsQuery.data, search],
  );

  if (group) {
    return (
      <Text color="destructive" align="center" style={styles.notice}>
        {t('expense.one_group_only')}
      </Text>
    );
  }

  const onGroupSelect = (selected: GroupWithMembers) => {
    selectGroup(
      selected,
      selected.groupUsers.map((groupUser) => groupUser.user),
    );
    setNameOrEmail('');
  };

  // A group can't be combined with other people.
  const showGroups = 1 === participants.length && !!groups?.length;
  const isLoading = friendsQuery.isLoading || groupsQuery.isLoading;

  const onInvite = (sendInviteEmail: boolean) => {
    setNameOrEmail(email);
    invite(email, sendInviteEmail);
  };

  const inviteFooter = isEmail
    ? [invitesEnabled ? t('invite.warning') : null, t('expense.add_email', { email })]
        .filter(Boolean)
        .join('\n\n')
    : t('expense.add_to_splitpro_hint');

  return (
    <View>
      {'' === email ? null : (
        <Section footer={inviteFooter} separatorInset={rowInset(22)}>
          <ListRow
            left={<Icon name={icons.personAdd} color={isEmail ? colors.tint : undefined} />}
            title={t('expense.add_to_splitpro')}
            action
            disabled={!isEmail}
            onPress={() => onInvite(false)}
            accessibilityLabel={t('expense.add_to_splitpro')}
          />
          {invitesEnabled ? (
            <ListRow
              left={<Icon name={icons.send} color={isEmail ? colors.tint : undefined} />}
              title={t('invite.send')}
              action
              disabled={!isEmail}
              onPress={() => onInvite(true)}
              accessibilityLabel={t('invite.send')}
            />
          ) : null}
        </Section>
      )}

      {isLoading ? <LoadingRows /> : null}

      {friends?.length ? (
        <Section
          header={t('expense.friends')}
          footer={'' === email ? t('expense.add_to_splitpro_hint') : undefined}
          separatorInset={rowInset(AVATAR_SIZE)}
        >
          {friends.map((friend) => {
            const isSelected = participants.some((participant) => participant.id === friend.id);
            return (
              <ListRow
                key={friend.id}
                left={
                  <Avatar
                    name={friend.name}
                    email={friend.email}
                    image={friend.image}
                    size={AVATAR_SIZE}
                  />
                }
                title={friend.name ?? friend.email ?? ''}
                accessory={isSelected ? 'checkmark' : undefined}
                onPress={() => {
                  haptics.selection();
                  if (isSelected) {
                    removeParticipant(friend.id);
                  } else {
                    addOrUpdateParticipant(friend);
                  }
                  setNameOrEmail('');
                }}
              />
            );
          })}
        </Section>
      ) : null}

      {showGroups ? (
        <Section header={t('expense.groups')} separatorInset={rowInset(AVATAR_SIZE)}>
          {groups.map((entry) => (
            <ListRow
              key={entry.groupId}
              left={<Avatar name={entry.group.name} size={AVATAR_SIZE} />}
              title={entry.group.name}
              subtitle={t('expense.member_count', { count: entry.group.groupUsers.length })}
              onPress={() => onGroupSelect(entry.group)}
            />
          ))}
        </Section>
      ) : null}

      {!isLoading && !isEmail && !friends?.length && !groups?.length ? (
        <EmptyState
          icon={icons.groups}
          title={t('expense.no_matches')}
          description={t('expense.no_matches_description')}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  notice: {
    marginHorizontal: layout.sectionMargin,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: layout.rowMinHeight + spacing[2],
    paddingHorizontal: layout.rowPadding,
  },
});
