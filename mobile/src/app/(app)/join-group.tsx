import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon, Screen, Spinner, Text, icons, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

/**
 * Opens an invite link, `/join-group?groupId=<publicId>` like the web's src/pages/join-group.tsx:
 * joins the group (or skips that if you're already in it) and opens it.
 */
const JoinGroup = () => {
  const { t } = useTranslation();
  const { groupId: publicId } = useLocalSearchParams<{ groupId?: string }>();
  const utils = api.useUtils();
  const joinGroupMutation = api.group.joinGroup.useMutation();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const openGroup = (groupId: number) =>
      router.replace({ pathname: '/groups/[groupId]', params: { groupId: String(groupId) } });
    // Back to the tabs under this screen, rather than a second copy of them
    const openGroups = () => router.dismissTo('/groups');

    const join = async () => {
      if (!publicId) {
        openGroups();
        return;
      }

      try {
        const memberships = await utils.group.getAllGroups.fetch();
        const existing = memberships.find((membership) => publicId === membership.group.publicId);

        if (existing) {
          openGroup(existing.groupId);
          return;
        }

        const group = await joinGroupMutation.mutateAsync({ groupId: publicId });
        toast.success(t('groups.joined', { name: group.name }));
        void utils.group.getAllGroupsWithBalances.invalidate();
        void utils.group.getAllGroups.invalidate();
        openGroup(group.id);
      } catch (error) {
        console.warn(error);
        toast.error(t('groups.join_failed'));
        openGroups();
      }
    };

    void join();
  }, [joinGroupMutation, publicId, t, utils]);

  return (
    // Shown for a moment while the invite is accepted, like ContentUnavailableView with progress.
    <Screen edges={['top', 'bottom']} background="grouped">
      <View style={styles.container} accessibilityLiveRegion="polite">
        <Icon name={icons.groups} size={56} color={colors.secondaryLabel} />
        <Text variant="title2" align="center" accessibilityRole="header">
          {t('groups.joining')}
        </Text>
        <Spinner size="large" />
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    paddingHorizontal: spacing[8],
  },
});

export default JoinGroup;
