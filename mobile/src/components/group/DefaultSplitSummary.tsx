import { router } from 'expo-router';
import { type TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import {
  type DefaultSplit,
  getDefaultSplitNote,
  getGroupDefaultSplit,
  joinNames,
  resolveDefaultSplit,
} from '~/utils/defaultSplit';

import { getPersonName } from '@/components/expense';
import { ListRow, Section, Text } from '@/components/ui';
import { type RouterOutputs } from '@/lib/api';

type GroupDetails = NonNullable<RouterOutputs['group']['getGroupDetails']>;
type Member = { id: number; name: string | null; email: string | null };

/** E.g. "Alex 60% · Sam 40%", for the members of the group now. */
const describeSplit = (split: DefaultSplit, members: Member[], t: TFunction) => {
  if ('EQUAL' === split.splitType) {
    const included = members.filter((member) => 0 !== (split.shares[member.id] ?? 1));
    return t('groups.default_split_equally', { names: joinNames(included.map(getPersonName)) });
  }

  return members
    .filter((member) => undefined !== split.shares[member.id])
    .map((member) => {
      const value = split.shares[member.id] ?? 0;
      return 'PERCENTAGE' === split.splitType
        ? `${getPersonName(member)} ${value}%`
        : `${getPersonName(member)} ${t('groups.share_count', { count: value })}`;
    })
    .join(' · ');
};

/**
 * The group's default split for new expenses as a settings row that opens the editor, like the
 * web's `GroupDefaultSplit`. Who set it goes in the footer.
 */
export const DefaultSplitSection: React.FC<{ group: GroupDetails }> = ({ group }) => {
  const { t } = useTranslation();
  const members = group.groupUsers.map((groupUser) => groupUser.user);
  const current = getGroupDefaultSplit(group);
  const resolved = current
    ? resolveDefaultSplit(
        current,
        members.map((member) => member.id),
      )
    : undefined;
  const note =
    current && resolved
      ? getDefaultSplitNote(
          current,
          members.filter((member) => resolved.addedIds.includes(member.id)).map(getPersonName),
          resolved.outdated,
        )
      : undefined;

  return (
    <Section
      header={t('groups.default_split')}
      footer={
        current && group.defaultSplitBy
          ? t('groups.default_split_set_by', { name: getPersonName(group.defaultSplitBy) })
          : undefined
      }
    >
      <ListRow
        title={
          <Text numberOfLines={3}>
            {current ? describeSplit(current, members, t) : t('groups.default_split_none')}
          </Text>
        }
        subtitle={
          note ? (
            <View style={styles.note}>
              <Text variant="footnote" color="negative">
                {note}
              </Text>
            </View>
          ) : undefined
        }
        accessory="chevron"
        onPress={() =>
          router.push({
            pathname: '/groups/[groupId]/default-split',
            params: { groupId: String(group.id) },
          })
        }
      />
    </Section>
  );
};

const styles = StyleSheet.create({
  note: {
    paddingTop: 2,
  },
});
