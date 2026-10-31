import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Icon, ListRow, Section, icons } from '@/components/ui';
import { colors } from '@/theme/tokens';

import { shareInviteLink } from './invite';

/** A group with only you in it and no expenses: add members or share the invite link. */
export const NoMembers: React.FC<{ group: { id: number; name: string; publicId: string } }> = ({
  group,
}) => {
  const { t } = useTranslation();

  return (
    <Section footer={t('groups.no_members')}>
      <ListRow
        left={<Icon name={icons.groupAdd} color={colors.tint} />}
        title={t('groups.add_members')}
        action
        onPress={() =>
          router.push({
            pathname: '/groups/[groupId]/add-members',
            params: { groupId: String(group.id) },
          })
        }
      />
      <ListRow
        left={<Icon name={icons.share} color={colors.tint} />}
        title={t('groups.share_invite_link')}
        action
        onPress={() => void shareInviteLink(group, t)}
      />
    </Section>
  );
};
