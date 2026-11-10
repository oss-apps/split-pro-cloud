import {
  Button,
  DatePicker,
  Form,
  HStack,
  Host,
  Image,
  Menu,
  Picker,
  RNHostView,
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
  accessibilityAddTraits,
  accessibilityLabel,
  buttonStyle,
  datePickerStyle,
  disabled,
  font,
  fixedSize,
  foregroundStyle,
  keyboardType,
  listRowBackground,
  listRowSeparator,
  multilineTextAlignment,
  onSubmit,
  padding,
  pickerStyle,
  scrollDismissesKeyboard,
  submitLabel,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { SplitType } from '@prisma/client';
import { startOfDay } from 'date-fns';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { getDefaultSplitNote } from '~/utils/defaultSplit';
import { MAX_AMOUNT_CENTS, toUIString } from '~/utils/numbers';

import { CurrencySheet, Sheet, SheetHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import {
  isPendingInvite,
  isSplitWaitingForInvite,
  useAddExpenseStore,
} from '@/store/addExpenseStore';
import { useRecentCurrencies } from '@/store/recentCurrencies';
import { colors } from '@/theme/tokens';

import { RepeatRow, useRepeatFooter } from './DetailRows';
import { ParticipantsInput } from './ParticipantsInput';
import { ReceiptRow } from './ReceiptRow';
import { SelectUserOrGroup } from './SelectUserOrGroup';
import { NativeSplitEditor } from './NativeSplitEditor.ios';
import { parseAmountInput, sanitizeAmountInput, toggleAmountSign } from './amountInput';
import { CATEGORY_SECTIONS, type CategoryKey, toCategory } from './categories';

/** All edits go through the shared store; the host owns only native presentation/focus state. */
export const NativeExpenseForm = ({
  expenseId,
  isAmountTooLarge,
}: {
  expenseId: string | undefined;
  isAmountTooLarge: boolean;
}) => {
  const { t } = useTranslation();
  const state = useAddExpenseStore();
  const { actions } = state;
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const amountText = useNativeState(state.amountStr);
  const descriptionText = useNativeState(state.description);
  const amountRef = useRef<React.ComponentRef<typeof TextField>>(null);
  const descriptionRef = useRef<React.ComponentRef<typeof TextField>>(null);
  const rememberCurrency = useRecentCurrencies((s) => s.remember);
  const recentCurrencies = useRecentCurrencies((s) => s.recent);
  const updateProfile = api.user.updateUserDetail.useMutation();
  const repeatFooter = useRepeatFooter();
  const waiting = isSplitWaitingForInvite(state);
  const [today] = useState(() => new Date());

  const blur = () => {
    void amountRef.current?.blur();
    void descriptionRef.current?.blur();
  };
  const changeAmount = (text: string) => {
    const clean = sanitizeAmountInput(text);
    if (clean !== text) amountText.set(clean);
    actions.setAmountStr(clean);
    actions.setAmount(parseAmountInput(clean));
  };
  const people =
    state.group?.name ??
    state.participants
      .filter((person) => person.id !== state.currentUser?.id)
      .map((person) => person.name ?? person.email ?? '')
      .join(', ');
  const splitNote = state.defaultSplitHint
    ? getDefaultSplitNote(
        state.defaultSplitHint,
        state.participants
          .filter((p) => state.defaultSplitHint?.addedIds.includes(p.id))
          .map((p) => p.name ?? p.email ?? ''),
        state.defaultSplitHint.outdated,
      )
    : undefined;

  return (
    <>
      <Host style={{ flex: 1 }} seedColor={colors.tint}>
        <Toolbar>
          <Form modifiers={[scrollDismissesKeyboard('interactively')]}>
            <Section>
              <Button
                onPress={() => {
                  blur();
                  setPeopleOpen(true);
                }}
                modifiers={[buttonStyle('plain')]}
              >
                <HStack spacing={12}>
                  <Image systemName="person.2" color={colors.tint} />
                  <Text>{t('expense.with_you_and')}</Text>
                  <Spacer />
                  <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>
                    {people || t('expense.add_more_friends')}
                  </Text>
                  <Image
                    systemName="chevron.right"
                    modifiers={[
                      font({ textStyle: 'caption', weight: 'semibold' }),
                      foregroundStyle({ type: 'hierarchical', style: 'tertiary' }),
                    ]}
                  />
                </HStack>
              </Button>
            </Section>
            <Section>
              <VStack
                spacing={12}
                modifiers={[
                  fixedSize({ horizontal: false, vertical: true }),
                  padding({ vertical: 12 }),
                  listRowBackground('clear'),
                  listRowSeparator('hidden'),
                ]}
              >
                <Button
                  label={state.currency}
                  systemImage="chevron.up.chevron.down"
                  onPress={() => {
                    blur();
                    setCurrencyOpen(true);
                  }}
                  modifiers={[buttonStyle('bordered'), font({ textStyle: 'subheadline' })]}
                />
                <TextField
                  ref={amountRef}
                  text={amountText}
                  placeholder={t('expense.amount_hero_placeholder')}
                  onTextChange={changeAmount}
                  modifiers={[
                    keyboardType('decimal-pad'),
                    font({ textStyle: 'largeTitle', weight: 'medium' }),
                    multilineTextAlignment('center'),
                    accessibilityLabel(t('expense.amount_placeholder')),
                    ...(isAmountTooLarge ? [foregroundStyle(colors.destructive)] : []),
                  ]}
                />
                <Button
                  label={t('expense.refund')}
                  systemImage="arrow.uturn.backward"
                  onPress={() => {
                    haptics.selection();
                    const next = toggleAmountSign(state.amountStr);
                    amountText.set(next);
                    changeAmount(next);
                  }}
                  modifiers={[
                    buttonStyle(state.amountStr.startsWith('-') ? 'borderedProminent' : 'bordered'),
                    font({ textStyle: 'caption' }),
                    accessibilityLabel(t('expense.toggle_refund')),
                    accessibilityAddTraits(state.amountStr.startsWith('-') ? ['isSelected'] : []),
                  ]}
                />
                {isAmountTooLarge ? (
                  <Text
                    modifiers={[
                      font({ textStyle: 'footnote' }),
                      foregroundStyle(colors.destructive),
                    ]}
                  >
                    {t('expense.amount_too_large', { max: toUIString(MAX_AMOUNT_CENTS) })}
                  </Text>
                ) : state.amountStr.startsWith('-') ? (
                  <Text modifiers={[font({ textStyle: 'footnote' })]}>
                    {t('expense.refund_hint')}
                  </Text>
                ) : null}
              </VStack>
            </Section>
            <Section>
              <TextField
                ref={descriptionRef}
                text={descriptionText}
                placeholder={t('expense.description_placeholder')}
                onTextChange={actions.setDescription}
                modifiers={[
                  submitLabel('done'),
                  // This modifier registers a native event; it does not invoke the callback during render.
                  // eslint-disable-next-line react-hooks/refs
                  onSubmit(() => blur()),
                  accessibilityLabel(t('expense.description_placeholder')),
                ]}
              />
            </Section>
            <Section
              footer={
                waiting || splitNote ? (
                  <Text>{waiting ? t('expense.split_waiting') : splitNote}</Text>
                ) : undefined
              }
            >
              <Picker
                label={t('expense.paid_by')}
                systemImage="person.crop.circle"
                selection={state.paidBy?.id}
                onSelectionChange={(id: number) => {
                  blur();
                  const person = state.participants.find((p) => p.id === id);
                  if (person && !isPendingInvite(person)) {
                    haptics.selection();
                    actions.setPaidBy(person);
                  }
                }}
                modifiers={[pickerStyle('menu')]}
              >
                {state.participants.map((person) => (
                  <Text
                    key={person.id}
                    modifiers={[tag(person.id), disabled(isPendingInvite(person))]}
                  >
                    {person.id === state.currentUser?.id
                      ? t('expense.payer_you')
                      : (person.name ?? person.email ?? '')}
                  </Text>
                ))}
              </Picker>
              <Menu
                label={
                  <HStack>
                    <Text>{t('expense.split')}</Text>
                    <Spacer />
                    <Text
                      modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}
                    >
                      {t(`expense.split_value.${state.splitType}`)}
                    </Text>
                    <Image
                      systemName="chevron.up.chevron.down"
                      modifiers={[font({ textStyle: 'caption' })]}
                    />
                  </HStack>
                }
              >
                {[
                  SplitType.EQUAL,
                  SplitType.PERCENTAGE,
                  SplitType.EXACT,
                  SplitType.SHARE,
                  SplitType.ADJUSTMENT,
                ].map((type) => (
                  <Button
                    key={type}
                    label={t(`expense.split_types.${type}`)}
                    systemImage={type === state.splitType ? 'checkmark' : undefined}
                    onPress={() => {
                      blur();
                      haptics.selection();
                      actions.setSplitType(type);
                      actions.setSplitScreenOpen(true);
                    }}
                    modifiers={[disabled(waiting)]}
                  />
                ))}
                <Button
                  label={t('expense.change_split')}
                  systemImage="slider.horizontal.3"
                  onPress={() => {
                    blur();
                    actions.setSplitScreenOpen(true);
                  }}
                />
              </Menu>
            </Section>
            <Section
              title={t('expense.details')}
              footer={repeatFooter ? <Text>{repeatFooter}</Text> : undefined}
            >
              <Menu
                label={
                  <HStack>
                    <Text>{t('expense.category')}</Text>
                    <Spacer />
                    <Text
                      modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}
                    >
                      {t(`expense.categories.${state.category as CategoryKey}`, {
                        defaultValue: t('expense.categories.general'),
                      })}
                    </Text>
                    <Image
                      systemName="chevron.up.chevron.down"
                      modifiers={[font({ textStyle: 'caption' })]}
                    />
                  </HStack>
                }
              >
                <Button
                  label={t('expense.categories.general')}
                  onPress={() => actions.setCategory('general')}
                />
                {CATEGORY_SECTIONS.map((section) => (
                  <Menu key={section.key} label={t(`expense.categories.${section.key}`)}>
                    {section.items.map((item) => {
                      const category = toCategory(section.key, item) as CategoryKey;
                      return (
                        <Button
                          key={item}
                          label={t(`expense.categories.${category}`)}
                          onPress={() => {
                            haptics.selection();
                            actions.setCategory(category);
                          }}
                        />
                      );
                    })}
                  </Menu>
                ))}
              </Menu>
              <DatePicker
                title={t('expense.date')}
                selection={state.expenseDate ?? today}
                displayedComponents={['date']}
                onDateChange={(date) => {
                  haptics.selection();
                  actions.setExpenseDate(startOfDay(date));
                }}
                modifiers={[datePickerStyle('compact')]}
              />
              {SplitType.SETTLEMENT !== state.splitType ? (
                <RNHostView matchContents={{ vertical: true }}>
                  <RepeatRow />
                </RNHostView>
              ) : null}
              <RNHostView matchContents={{ vertical: true }}>
                <ReceiptRow isEditing={!!expenseId} />
              </RNHostView>
            </Section>
          </Form>
          <Toolbar.Content>
            <ToolbarItem placement="keyboard">
              <HStack>
                <Spacer />
                <Button label={t('expense.done')} onPress={blur} />
              </HStack>
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>
      </Host>
      <Sheet visible={peopleOpen} onClose={() => setPeopleOpen(false)} size="large" padded={false}>
        <SheetHeader
          title={t('expense.with_you_and')}
          confirm={{
            label: t('expense.done'),
            onPress: () => {
              useAddExpenseStore.setState({ showFriends: false });
              setPeopleOpen(false);
            },
          }}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          <ParticipantsInput isEditing={!!expenseId} />
          <SelectUserOrGroup />
        </ScrollView>
      </Sheet>
      <CurrencySheet
        visible={currencyOpen}
        value={state.currency}
        recent={recentCurrencies}
        onChange={(code) => {
          updateProfile.mutate({ currency: code });
          actions.setCurrency(code);
          actions.setPreferredCurrency(code);
          rememberCurrency(code);
        }}
        onClose={() => setCurrencyOpen(false)}
      />
      <NativeSplitEditor />
    </>
  );
};
