import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { getPersonName } from '@/components/expense';
import { useGroupDetails, useGroupIdParam } from '@/components/group/useGroupDetails';
import {
  Avatar,
  EmptyState,
  FullScreenSpinner,
  Icon,
  ListRow,
  ModalHeader,
  Screen,
  Section,
  SectionCell,
  SectionHeader,
  Spinner,
  Text,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { useAppConfig } from '@/lib/appConfig';
import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme/tokens';

const emailSchema = z.string().trim().toLowerCase().email();
const FRIEND_AVATAR = 36;

type Friend = RouterOutputs['user']['getFriends'][number];
type FriendSection = { key: string; title: string; data: Friend[] };

/** Pick friends to add, or add someone new by email, like the web's `AddMembers` drawer. */
const AddMembers = () => {
  const { t } = useTranslation();
  const groupId = useGroupIdParam();
  const utils = api.useUtils();
  const { group, notFound } = useGroupDetails(groupId);
  const friendsQuery = api.user.getFriends.useQuery();
  const addMembersMutation = api.group.addMembers.useMutation();
  const inviteFriendMutation = api.user.inviteFriend.useMutation();
  const { invitesEnabled } = useAppConfig();
  const [sendingInvite, setSendingInvite] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState('');

  const isSaving = addMembersMutation.isLoading || inviteFriendMutation.isLoading;

  const save = (userIds: number[]) => {
    if (!userIds.length) {
      router.back();
      return;
    }

    addMembersMutation.mutate(
      { groupId, userIds },
      {
        onSuccess: () => {
          void utils.group.getGroupDetails.invalidate({ groupId });
          void utils.group.getAllGroups.invalidate();
          toast.success(t('groups.members_added', { count: userIds.length }));
          router.back();
        },
        onError: (error) => toast.error(error.message || t('common.something_went_wrong')),
      },
    );
  };

  const header = (
    <>
      <Stack.SearchBar
        placeholder={t('groups.search_people')}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        autoCapitalize="none"
        inputType="email"
        hideWhenScrolling={false}
        // Keeps Cancel and Done reachable while searching.
        hideNavigationBar={false}
        obscureBackground={false}
        placement="stacked"
      />
      <ModalHeader
        onCancel={() => router.back()}
        confirm={{
          label: t('groups.done'),
          disabled: !selected.size || isSaving,
          loading: addMembersMutation.isLoading,
          onPress: () => save([...selected]),
        }}
      />
    </>
  );

  if (notFound) {
    return (
      <Screen edges={[]} background="grouped">
        {header}
        <EmptyState icon={icons.groups} title={t('groups.not_found')} />
      </Screen>
    );
  }

  if (!group) {
    return (
      <>
        {header}
        <FullScreenSpinner grouped />
      </>
    );
  }

  const memberIds = new Set(group.groupUsers.map((groupUser) => groupUser.userId));
  const search = query.trim().toLowerCase();
  const candidates = (friendsQuery.data ?? []).filter((friend) => !memberIds.has(friend.id));
  const matches = candidates.filter((friend) =>
    getPersonName(friend).toLowerCase().includes(search),
  );
  // Ticked friends the search hides stay on screen, so they can be seen and unticked.
  const hiddenSelected = candidates.filter(
    (friend) => selected.has(friend.id) && !matches.includes(friend),
  );
  const sections: FriendSection[] = [
    ...(hiddenSelected.length
      ? [{ key: 'selected', title: t('groups.selected_title'), data: hiddenSelected }]
      : []),
    ...(matches.length
      ? [
          {
            key: 'friends',
            title:
              selected.size && !hiddenSelected.length
                ? `${t('groups.friends')} · ${t('groups.selected', { count: selected.size })}`
                : t('groups.friends'),
            data: matches,
          },
        ]
      : []),
  ];
  const email = emailSchema.safeParse(query);

  const toggle = (userId: number) => {
    haptics.selection();
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const addByEmail = (sendInviteEmail: boolean) => {
    if (!email.success) {
      return;
    }

    setSendingInvite(sendInviteEmail);
    inviteFriendMutation.mutate(
      { email: email.data, sendInviteEmail },
      {
        onSuccess: (user) => {
          void utils.user.getFriends.invalidate();
          save([...selected, user.id]);
        },
        onError: (error) => toast.error(error.message || t('common.something_went_wrong')),
      },
    );
  };

  const emailActions = email.success ? (
    <Section footer={invitesEnabled ? t('invite.warning') : undefined}>
      {invitesEnabled ? (
        <ListRow
          left={<Icon name={icons.mail} color={colors.tint} />}
          title={t('invite.send')}
          action
          disabled={isSaving}
          right={inviteFriendMutation.isLoading && sendingInvite ? <Spinner /> : undefined}
          onPress={() => addByEmail(true)}
        />
      ) : null}
      <ListRow
        left={<Icon name={icons.groupAdd} color={colors.tint} />}
        title={
          <Text color="tint" numberOfLines={2}>
            {t('groups.add_to_splitpro', { email: email.data })}
          </Text>
        }
        action
        disabled={isSaving}
        right={inviteFriendMutation.isLoading && !sendingInvite ? <Spinner /> : undefined}
        onPress={() => addByEmail(false)}
      />
    </Section>
  ) : null;

  const noMatches =
    '' !== search && !matches.length && !email.success && !friendsQuery.isLoading ? (
      <EmptyState
        icon={icons.search}
        title={t('groups.no_friend_matches')}
        description={t('groups.enter_valid_email')}
      />
    ) : null;

  const empty = (() => {
    if (friendsQuery.isLoading) {
      return (
        <View style={styles.loading}>
          <Spinner />
        </View>
      );
    }

    if (email.success || '' !== search) {
      return null;
    }

    return <EmptyState icon={icons.person} title={t('groups.no_friends')} />;
  })();

  return (
    <>
      {header}
      <SectionList
        sections={sections}
        keyExtractor={(friend) => String(friend.id)}
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={emailActions ?? undefined}
        ListFooterComponent={hiddenSelected.length ? (noMatches ?? undefined) : undefined}
        ListEmptyComponent={empty ?? noMatches ?? undefined}
        renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
        renderItem={({ item, index, section }) => (
          <SectionCell
            first={0 === index}
            last={index === section.data.length - 1}
            separatorInset={rowInset(FRIEND_AVATAR)}
          >
            <ListRow
              left={
                <Avatar
                  name={item.name}
                  email={item.email}
                  image={item.image}
                  size={FRIEND_AVATAR}
                />
              }
              title={getPersonName(item)}
              subtitle={item.name && item.email ? item.email : undefined}
              accessory={selected.has(item.id) ? 'checkmark' : undefined}
              onPress={() => toggle(item.id)}
            />
          </SectionCell>
        )}
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
    paddingTop: spacing[4],
    paddingBottom: spacing[12],
  },
  loading: {
    paddingVertical: spacing[8],
    alignItems: 'center',
  },
});

export default AddMembers;
