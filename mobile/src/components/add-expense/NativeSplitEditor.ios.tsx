import {
  BottomSheet,
  Button,
  Form,
  Group,
  HStack,
  Host,
  Image,
  NavigationStack,
  Picker,
  Section,
  Spacer,
  Text,
  TextField,
  Toolbar,
  ToolbarItem,
  VStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  interactiveDismissDisabled,
  keyboardType,
  multilineTextAlignment,
  navigationBarTitleDisplayMode,
  navigationTitle,
  pickerStyle,
  presentationDetents,
  presentationDragIndicator,
  scrollDismissesKeyboard,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { SplitType } from '@prisma/client';
import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';

import { toInteger, toSignedUIString } from '~/utils/numbers';

import { haptics } from '@/lib/haptics';
import {
  type Participant,
  isSplitWaitingForInvite,
  useAddExpenseStore,
} from '@/store/addExpenseStore';
import { colors } from '@/theme/tokens';

import {
  getParticipantShare,
  getSplitInputText,
  getSplitStatus,
  isEveryoneIncluded,
  parseSplitValue,
} from './splitStatus';

const TYPES = [
  SplitType.EQUAL,
  SplitType.PERCENTAGE,
  SplitType.EXACT,
  SplitType.SHARE,
  SplitType.ADJUSTMENT,
] as const;
type EditableType = (typeof TYPES)[number];

const SplitValue = ({
  person,
  type,
  isDisabled,
}: {
  person: Participant;
  type: EditableType;
  isDisabled: boolean;
}) => {
  const { t } = useTranslation();
  const value = useNativeState(getSplitInputText(person, type));
  const ref = useRef<React.ComponentRef<typeof TextField>>(null);
  const update = useAddExpenseStore((s) => s.actions.addOrUpdateParticipant);
  return (
    <TextField
      ref={ref}
      text={value}
      placeholder="0"
      onTextChange={(text) => update({ ...person, splitShare: parseSplitValue(text, type) })}
      modifiers={[
        keyboardType('decimal-pad'),
        multilineTextAlignment('trailing'),
        frame({ width: 90 }),
        disabled(isDisabled),
        accessibilityLabel(
          t('expense.split_value_label', { name: person.name ?? person.email ?? '' }),
        ),
      ]}
    />
  );
};

/** Same split engine/validation as the existing editor, inside a real SwiftUI Form. */
export const NativeSplitEditor = () => {
  const { t } = useTranslation();
  const state = useAddExpenseStore();
  const { actions, participants, currency, amount, paidBy } = state;
  const type = SplitType.SETTLEMENT === state.splitType ? SplitType.EQUAL : state.splitType;
  const waiting = isSplitWaitingForInvite(state);
  const format = (value: number) => `${currency} ${toSignedUIString(toInteger(value))}`;
  const status = getSplitStatus(type, participants, amount);
  const statusText = (() => {
    switch (status.kind) {
      case 'perPerson':
        return t('expense.per_person', { amount: format(status.amount) });
      case 'remainingAmount':
        return t('expense.remaining_amount', { amount: format(status.amount) });
      case 'remainingToSplit':
        return t('expense.remaining_to_split', { amount: format(status.amount) });
      case 'remainingPercentage':
        return t('expense.remaining_percentage', { percentage: status.percentage });
      case 'totalShares':
        return t('expense.total_shares', { shares: status.shares });
    }
  })();
  const close = () => {
    if (state.canSplitScreenClosed) actions.setSplitScreenOpen(false);
  };

  return (
    <Host matchContents seedColor={colors.tint}>
      <BottomSheet
        isPresented={state.splitScreenOpen}
        onIsPresentedChange={(presented) => {
          if (!presented) close();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['large']),
            presentationDragIndicator('visible'),
            interactiveDismissDisabled(!state.canSplitScreenClosed),
          ]}
        >
          <NavigationStack>
            <Toolbar>
              <Form
                modifiers={[
                  navigationTitle(t(`expense.split_types.${type}`)),
                  navigationBarTitleDisplayMode('inline'),
                  scrollDismissesKeyboard('interactively'),
                ]}
              >
                <Section>
                  <Picker
                    selection={type}
                    onSelectionChange={(next: EditableType) => {
                      haptics.selection();
                      actions.setSplitType(next);
                    }}
                    modifiers={[pickerStyle('segmented'), disabled(waiting)]}
                  >
                    {TYPES.map((option) => (
                      <Text key={option} modifiers={[tag(option)]}>
                        {t(`expense.split_short.${option}`)}
                      </Text>
                    ))}
                  </Picker>
                </Section>
                <Section
                  footer={
                    <Text
                      modifiers={[
                        foregroundStyle(
                          state.canSplitScreenClosed ? colors.secondaryLabel : colors.destructive,
                        ),
                      ]}
                    >
                      {waiting ? t('expense.split_waiting') : statusText}
                    </Text>
                  }
                >
                  {participants.map((person) => {
                    const name = person.name ?? person.email ?? '';
                    const label = (
                      <VStack alignment="leading" spacing={4}>
                        <Text>{name}</Text>
                        <Text
                          modifiers={[
                            font({ textStyle: 'subheadline' }),
                            foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                          ]}
                        >
                          {format(getParticipantShare(person, paidBy, amount))}
                        </Text>
                      </VStack>
                    );
                    return SplitType.EQUAL === type ? (
                      <Button
                        key={person.id}
                        onPress={() => {
                          haptics.selection();
                          actions.addOrUpdateParticipant({
                            ...person,
                            splitShare: 0 === person.splitShare ? 1 : 0,
                          });
                        }}
                        modifiers={[buttonStyle('plain'), disabled(waiting)]}
                      >
                        <HStack>
                          {label}
                          <Spacer />
                          {0 !== person.splitShare ? (
                            <Image systemName="checkmark" color={colors.tint} />
                          ) : null}
                        </HStack>
                      </Button>
                    ) : (
                      <HStack key={`${person.id}-${type}`}>
                        {label}
                        <Spacer />
                        {SplitType.EXACT === type || SplitType.ADJUSTMENT === type ? (
                          <Text
                            modifiers={[
                              foregroundStyle({ type: 'hierarchical', style: 'secondary' }),
                            ]}
                          >
                            {currency}
                          </Text>
                        ) : null}
                        <SplitValue person={person} type={type} isDisabled={waiting} />
                        {SplitType.PERCENTAGE === type ? (
                          <Text>%</Text>
                        ) : SplitType.SHARE === type ? (
                          <Text>{t('expense.shares_suffix')}</Text>
                        ) : null}
                      </HStack>
                    );
                  })}
                </Section>
                {SplitType.EQUAL === type ? (
                  <Section>
                    <Button
                      label={
                        isEveryoneIncluded(participants)
                          ? t('expense.deselect_all')
                          : t('expense.select_all')
                      }
                      modifiers={[disabled(waiting)]}
                      onPress={() => {
                        haptics.selection();
                        const all = isEveryoneIncluded(participants);
                        participants.forEach((person) =>
                          actions.addOrUpdateParticipant({ ...person, splitShare: all ? 0 : 1 }),
                        );
                      }}
                    />
                  </Section>
                ) : null}
              </Form>
              <Toolbar.Content>
                <ToolbarItem placement="keyboard">
                  <HStack>
                    <Spacer />
                    <Button label={t('expense.done')} onPress={Keyboard.dismiss} />
                  </HStack>
                </ToolbarItem>
                <ToolbarItem placement="confirmationAction">
                  <Button
                    label={t('expense.done')}
                    onPress={close}
                    modifiers={[disabled(!state.canSplitScreenClosed)]}
                  />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationStack>
        </Group>
      </BottomSheet>
    </Host>
  );
};
