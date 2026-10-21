import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import {
  DEFAULT_SPLIT_TYPES,
  type DefaultSplit,
  type DefaultSplitType,
  getDefaultSplitError,
  getEditorSplit,
  getEditorValues,
  getGroupDefaultSplit,
} from '~/utils/defaultSplit';
import { sumHundredths } from '~/utils/numbers';

import { getPersonName } from '@/components/expense';
import { useGroupDetails, useGroupIdParam } from '@/components/group/useGroupDetails';
import {
  Avatar,
  EmptyState,
  FullScreenSpinner,
  ListRow,
  ModalHeader,
  Screen,
  Section,
  Spinner,
  Text,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { useConfirmDiscard } from '@/lib/navigation';
import { colors, layout, spacing, typography } from '@/theme/tokens';

type GroupDetails = NonNullable<RouterOutputs['group']['getGroupDetails']>;

const MEMBER_AVATAR = 30;

const TYPE_LABELS = {
  EQUAL: 'groups.split_equal',
  PERCENTAGE: 'groups.split_percentage',
  SHARE: 'groups.split_share',
} as const satisfies Record<DefaultSplitType, string>;

const close = () => router.back();

/** The editor, once the group is loaded so it can start from the current default. */
const DefaultSplitEditor: React.FC<{ group: GroupDetails }> = ({ group }) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const setDefaultSplitMutation = api.group.setDefaultSplit.useMutation();
  const members = group.groupUsers.map((groupUser) => groupUser.user);
  const memberIds = members.map((member) => member.id);
  const current = getGroupDefaultSplit(group);
  const [initial] = useState(() => ({
    splitType: current?.splitType ?? 'EQUAL',
    values: getEditorValues(current, memberIds),
  }));
  const [splitType, setSplitType] = useState<DefaultSplitType>(initial.splitType);
  const [values, setValues] = useState(initial.values);
  const [removing, setRemoving] = useState(false);
  const allowClose = useConfirmDiscard(
    splitType !== initial.splitType || JSON.stringify(values) !== JSON.stringify(initial.values),
  );

  const split = getEditorSplit(splitType, values[splitType], memberIds);
  const error = getDefaultSplitError(split, memberIds);
  const remainingPercentage = (10_000 - sumHundredths(Object.values(split.shares))) / 100;
  const isSaving = setDefaultSplitMutation.isLoading;

  const setValue = (memberId: number, value: string) =>
    setValues((previous) => ({
      ...previous,
      [splitType]: { ...previous[splitType], [memberId]: value },
    }));

  const save = (splitToSave: DefaultSplit | null) => {
    setRemoving(null === splitToSave);
    setDefaultSplitMutation.mutate(
      { groupId: group.id, split: splitToSave },
      {
        onSuccess: () => {
          void utils.group.getGroupDetails.invalidate({ groupId: group.id });
          void utils.group.getAllGroups.invalidate();
          allowClose();
          router.back();
        },
        onError: (mutationError) => toast.error(mutationError.message),
      },
    );
  };

  return (
    <Screen keyboard scroll edges={[]} background="grouped" padded={false}>
      <ModalHeader
        onCancel={close}
        confirm={{
          label: t('groups.save'),
          disabled: !!error || isSaving,
          loading: isSaving && !removing,
          onPress: () => save(split),
        }}
      />

      <View style={styles.segments}>
        <SegmentedControl
          values={DEFAULT_SPLIT_TYPES.map((type) => t(TYPE_LABELS[type]))}
          selectedIndex={DEFAULT_SPLIT_TYPES.indexOf(splitType)}
          onChange={({ nativeEvent }) => {
            const type = DEFAULT_SPLIT_TYPES[nativeEvent.selectedSegmentIndex];
            if (type) {
              haptics.selection();
              setSplitType(type);
            }
          }}
        />
      </View>

      <Section
        separatorInset={rowInset(MEMBER_AVATAR)}
        footer={error ?? t('groups.default_split_description', { name: group.name })}
      >
        {members.map((member) => {
          const name = getPersonName(member);
          const value = values[splitType][member.id];
          const avatar = (
            <Avatar
              name={member.name}
              email={member.email}
              image={member.image}
              size={MEMBER_AVATAR}
            />
          );

          if ('EQUAL' === splitType) {
            const isIncluded = '0' !== value;

            return (
              <ListRow
                key={member.id}
                left={avatar}
                title={name}
                accessory={isIncluded ? 'checkmark' : undefined}
                accessibilityLabel={t('groups.include_member', { name })}
                onPress={() => {
                  haptics.selection();
                  setValue(member.id, isIncluded ? '0' : '1');
                }}
              />
            );
          }

          return (
            <ListRow
              key={member.id}
              left={avatar}
              title={name}
              right={
                <View style={styles.value}>
                  <TextInput
                    value={value ?? ''}
                    onChangeText={(text) => setValue(member.id, text.replace(',', '.'))}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                    placeholder="0"
                    placeholderTextColor={colors.placeholder}
                    accessibilityLabel={`${name} ${t(TYPE_LABELS[splitType])}`}
                    selectionColor={colors.tint}
                    cursorColor={colors.tint}
                    style={styles.valueInput}
                  />
                  <Text color="secondaryLabel" style={styles.unit}>
                    {'PERCENTAGE' === splitType ? '%' : t('groups.shares_unit')}
                  </Text>
                </View>
              }
            />
          );
        })}
        {'PERCENTAGE' === splitType ? (
          <ListRow
            title={t('groups.remaining')}
            right={
              <Text color={0 === remainingPercentage ? 'secondaryLabel' : 'destructive'} tabular>
                {`${remainingPercentage}%`}
              </Text>
            }
          />
        ) : null}
      </Section>

      {current ? (
        <Section>
          <ListRow
            title={t('groups.remove_default_split')}
            destructive
            disabled={isSaving}
            right={isSaving && removing ? <Spinner /> : undefined}
            onPress={() => save(null)}
          />
        </Section>
      ) : null}
    </Screen>
  );
};

/** Sets the split new expenses in the group start with, like the web's `GroupDefaultSplit`. */
const DefaultSplitScreen = () => {
  const { t } = useTranslation();
  const groupId = useGroupIdParam();
  const { group, notFound } = useGroupDetails(groupId);

  return (
    <>
      {notFound ? (
        <Screen edges={[]} background="grouped">
          <ModalHeader onCancel={close} />
          <EmptyState icon={icons.groups} title={t('groups.not_found')} />
        </Screen>
      ) : group ? (
        <DefaultSplitEditor group={group} />
      ) : (
        <>
          <ModalHeader onCancel={close} />
          <FullScreenSpinner grouped />
        </>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  segments: {
    paddingHorizontal: layout.sectionMargin,
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
  },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  valueInput: {
    ...typography.body,
    lineHeight: undefined,
    minWidth: 64,
    paddingVertical: spacing[1],
    color: colors.label,
    textAlign: 'right',
  },
  unit: {
    minWidth: 20,
  },
});

export default DefaultSplitScreen;
