import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { SplitType } from '@prisma/client';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toInteger, toSignedUIString } from '~/utils/numbers';

import { Avatar, ListRow, Separator, Sheet, SheetHeader, Text, rowInset } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import {
  type Participant,
  isSplitWaitingForInvite,
  useAddExpenseStore,
} from '@/store/addExpenseStore';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

import {
  type SplitStatus,
  getParticipantShare,
  getSplitInputText,
  getSplitStatus,
  isEveryoneIncluded,
  parseSplitValue,
} from './splitStatus';

type EditableSplitType = Exclude<SplitType, 'SETTLEMENT'>;

const SPLIT_TYPES: EditableSplitType[] = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.EXACT,
  SplitType.SHARE,
  SplitType.ADJUSTMENT,
];

const AVATAR_SIZE = 32;

const formatAmount = (currency: string, amount: number) =>
  `${currency} ${toSignedUIString(toInteger(amount))}`;

const useStatusText = (status: SplitStatus, currency: string) => {
  const { t } = useTranslation();

  switch (status.kind) {
    case 'perPerson':
      return t('expense.per_person', { amount: formatAmount(currency, status.amount) });
    case 'remainingPercentage':
      return t('expense.remaining_percentage', { percentage: status.percentage });
    case 'remainingAmount':
      return t('expense.remaining_amount', { amount: formatAmount(currency, status.amount) });
    case 'totalShares':
      return t('expense.total_shares', { shares: status.shares });
    case 'remainingToSplit':
      return t('expense.remaining_to_split', { amount: formatAmount(currency, status.amount) });
  }
};

/** Everyone's values for one split type. Mounted per type, so the inputs start from the form. */
const SplitInputs: React.FC<{ splitType: EditableSplitType; disabled: boolean }> = ({
  splitType,
  disabled,
}) => {
  const { t } = useTranslation();
  const participants = useAddExpenseStore((s) => s.participants);
  const currency = useAddExpenseStore((s) => s.currency);
  const amount = useAddExpenseStore((s) => s.amount);
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const canSplitScreenClosed = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const { addOrUpdateParticipant } = useAddExpenseStore((s) => s.actions);
  const [texts, setTexts] = useState(() =>
    Object.fromEntries(
      participants.map((participant) => [
        participant.id,
        getSplitInputText(participant, splitType),
      ]),
    ),
  );

  const statusText = useStatusText(getSplitStatus(splitType, participants, amount), currency);
  const isEqual = SplitType.EQUAL === splitType;
  const allSelected = isEveryoneIncluded(participants);

  const onChangeText = (participant: Participant, text: string) => {
    setTexts((current) => ({ ...current, [participant.id]: text }));
    addOrUpdateParticipant({ ...participant, splitShare: parseSplitValue(text, splitType) });
  };

  const toggle = (participant: Participant) => {
    haptics.selection();
    addOrUpdateParticipant({ ...participant, splitShare: 0 === participant.splitShare ? 1 : 0 });
  };

  const toggleAll = () => {
    haptics.selection();
    participants.forEach((participant) =>
      addOrUpdateParticipant({ ...participant, splitShare: allSelected ? 0 : 1 }),
    );
  };

  const suffix =
    SplitType.PERCENTAGE === splitType
      ? '%'
      : SplitType.SHARE === splitType
        ? t('expense.shares_suffix')
        : undefined;
  const prefix =
    SplitType.EXACT === splitType || SplitType.ADJUSTMENT === splitType ? currency : undefined;

  const shareText = (participant: Participant) =>
    formatAmount(currency, getParticipantShare(participant, paidBy, amount));

  return (
    <View>
      {participants.map((participant, index) => {
        const name = participant.name ?? participant.email ?? '';
        const avatar = (
          <Avatar
            name={participant.name}
            email={participant.email}
            image={participant.image}
            size={AVATAR_SIZE}
          />
        );

        return (
          <React.Fragment key={participant.id}>
            {0 < index ? <Separator inset={rowInset(AVATAR_SIZE)} /> : null}
            {isEqual ? (
              <ListRow
                left={avatar}
                title={name}
                subtitle={shareText(participant)}
                accessory={0 !== participant.splitShare ? 'checkmark' : undefined}
                disabled={disabled}
                onPress={() => toggle(participant)}
                accessibilityLabel={name}
              />
            ) : (
              <ListRow
                left={avatar}
                title={name}
                subtitle={SplitType.EXACT === splitType ? undefined : shareText(participant)}
                right={
                  <View style={styles.valueField}>
                    {prefix ? <Text color="secondaryLabel">{prefix}</Text> : null}
                    <TextInput
                      value={texts[participant.id] ?? ''}
                      onChangeText={(text) => onChangeText(participant, text)}
                      editable={!disabled}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      placeholder="0"
                      placeholderTextColor={colors.placeholder}
                      selectionColor={colors.tint}
                      cursorColor={colors.tint}
                      accessibilityLabel={t('expense.split_value_label', { name })}
                      style={styles.valueInput}
                    />
                    {suffix ? <Text color="secondaryLabel">{suffix}</Text> : null}
                  </View>
                }
              />
            )}
          </React.Fragment>
        );
      })}
      <Separator inset={0} />
      <View style={styles.footer}>
        <Text
          variant="footnote"
          weight="semibold"
          color={canSplitScreenClosed ? 'secondaryLabel' : 'destructive'}
          style={styles.status}
          accessibilityLiveRegion="polite"
        >
          {statusText}
        </Text>
        {isEqual ? (
          <Pressable onPress={toggleAll} disabled={disabled} hitSlop={8} accessibilityRole="button">
            <Text variant="footnote" weight="semibold" color="tint">
              {allSelected ? t('expense.deselect_all') : t('expense.select_all')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

/**
 * The split editor, like the web's split drawer: a segmented control for the split type, everyone's
 * values, and what's left to assign. It can't be closed until the split adds up.
 */
export const SplitEditorSheet: React.FC = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const splitScreenOpen = useAddExpenseStore((s) => s.splitScreenOpen);
  const canSplitScreenClosed = useAddExpenseStore((s) => s.canSplitScreenClosed);
  const splitType = useAddExpenseStore((s) => s.splitType);
  const isWaitingForInvite = useAddExpenseStore(isSplitWaitingForInvite);
  const { setSplitType, setSplitScreenOpen } = useAddExpenseStore((s) => s.actions);

  const close = () => {
    if (canSplitScreenClosed) {
      setSplitScreenOpen(false);
    }
  };

  const editableType = SplitType.SETTLEMENT === splitType ? SplitType.EQUAL : splitType;

  return (
    <Sheet visible={splitScreenOpen} onClose={close} size="large" padded={false}>
      <SheetHeader
        title={t(`expense.split_types.${editableType}`)}
        confirm={{ label: t('expense.done'), onPress: close, disabled: !canSplitScreenClosed }}
      />
      <View style={styles.segments}>
        <SegmentedControl
          values={SPLIT_TYPES.map((type) => t(`expense.split_short.${type}`))}
          selectedIndex={SPLIT_TYPES.indexOf(editableType)}
          enabled={!isWaitingForInvite}
          onChange={({ nativeEvent }) => {
            const type = SPLIT_TYPES[nativeEvent.selectedSegmentIndex];
            if (type && type !== splitType) {
              haptics.selection();
              setSplitType(type);
            }
          }}
        />
      </View>
      {isWaitingForInvite ? (
        <Text variant="footnote" align="center" style={styles.waiting}>
          {t('expense.split_waiting')}
        </Text>
      ) : null}
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[
          { paddingBottom: insets.bottom },
          isWaitingForInvite ? styles.disabled : null,
        ]}
      >
        <SplitInputs key={splitType} splitType={editableType} disabled={isWaitingForInvite} />
      </ScrollView>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  segments: {
    paddingHorizontal: layout.rowPadding,
    paddingBottom: spacing[3],
  },
  waiting: {
    paddingHorizontal: layout.rowPadding,
    paddingBottom: spacing[3],
  },
  scroll: {
    flex: 1,
  },
  disabled: {
    opacity: 0.6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: layout.rowPadding,
    paddingVertical: spacing[3],
  },
  status: {
    flex: 1,
  },
  valueField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  valueInput: {
    ...typography.body,
    lineHeight: undefined,
    minWidth: 76,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1] + 2,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.tertiaryFill,
    color: colors.label,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
