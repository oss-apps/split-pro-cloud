import { SplitType } from '@prisma/client';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDefaultSplitNote } from '~/utils/defaultSplit';

import { CurrencySheet, Input, Section, rowInset } from '@/components/ui';
import { api } from '@/lib/api';
import { isSplitWaitingForInvite, useAddExpenseStore } from '@/store/addExpenseStore';
import { useRecentCurrencies } from '@/store/recentCurrencies';

import { AmountField } from './AmountField';
import {
  CategoryRow,
  DETAIL_ICON_SIZE,
  DateRow,
  PaidByRow,
  RepeatRow,
  SplitRow,
  useRepeatFooter,
} from './DetailRows';
import { ParticipantsInput } from './ParticipantsInput';
import { ReceiptRow } from './ReceiptRow';
import { SelectUserOrGroup } from './SelectUserOrGroup';
import { SplitEditorSheet } from './SplitEditorSheet';

const DETAIL_INSET = rowInset(DETAIL_ICON_SIZE);

/**
 * The add/edit expense form, like the web's AddOrEditExpensePage, as an inset-grouped form: who
 * it's with, the amount, the description, then how it's split and the details. Saving is the
 * header's Save button.
 */
export const AddExpenseForm: React.FC<{
  expenseId: string | undefined;
  isAmountTooLarge: boolean;
}> = ({ expenseId, isAmountTooLarge }) => {
  const { t } = useTranslation();
  const [currencyOpen, setCurrencyOpen] = useState(false);

  const showFriends = useAddExpenseStore((s) => s.showFriends);
  const participants = useAddExpenseStore((s) => s.participants);
  const group = useAddExpenseStore((s) => s.group);
  const currency = useAddExpenseStore((s) => s.currency);
  const description = useAddExpenseStore((s) => s.description);
  const defaultSplitHint = useAddExpenseStore((s) => s.defaultSplitHint);
  const splitType = useAddExpenseStore((s) => s.splitType);
  const isWaitingForInvite = useAddExpenseStore(isSplitWaitingForInvite);
  const { setCurrency, setPreferredCurrency, setDescription } = useAddExpenseStore(
    (s) => s.actions,
  );
  const recentCurrencies = useRecentCurrencies((s) => s.recent);
  const rememberCurrency = useRecentCurrencies((s) => s.remember);
  const updateProfile = api.user.updateUserDetail.useMutation();
  const repeatFooter = useRepeatFooter();

  const onChangeCurrency = (code: string) => {
    updateProfile.mutate({ currency: code });
    setCurrency(code);
    setPreferredCurrency(code);
    rememberCurrency(code);
  };

  const defaultSplitNote = defaultSplitHint
    ? (getDefaultSplitNote(
        defaultSplitHint,
        participants
          .filter((participant) => defaultSplitHint.addedIds.includes(participant.id))
          .map((participant) => participant.name ?? participant.email ?? ''),
        defaultSplitHint.outdated,
      ) ?? t('expense.default_split_used'))
    : undefined;

  const showSelector = showFriends || (1 === participants.length && !group);

  return (
    <>
      <ParticipantsInput isEditing={!!expenseId} />
      {showSelector ? (
        <SelectUserOrGroup />
      ) : (
        <>
          <AmountField
            isAmountTooLarge={isAmountTooLarge}
            autoFocus={!expenseId}
            onPressCurrency={() => setCurrencyOpen(true)}
          />
          <Section>
            <Input
              inline
              value={description}
              onChangeText={setDescription}
              placeholder={t('expense.description_placeholder')}
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              autoCapitalize="sentences"
              accessibilityLabel={t('expense.description_placeholder')}
            />
          </Section>
          <Section
            footer={isWaitingForInvite ? t('expense.split_waiting') : defaultSplitNote}
            separatorInset={DETAIL_INSET}
          >
            <PaidByRow />
            <SplitRow />
          </Section>
          <Section
            header={t('expense.details')}
            footer={repeatFooter}
            separatorInset={DETAIL_INSET}
          >
            <CategoryRow />
            <DateRow />
            {SplitType.SETTLEMENT === splitType ? null : <RepeatRow />}
            <ReceiptRow isEditing={!!expenseId} />
          </Section>
        </>
      )}

      <CurrencySheet
        visible={currencyOpen}
        value={currency}
        recent={recentCurrencies}
        onChange={onChangeCurrency}
        onClose={() => setCurrencyOpen(false)}
      />
      <SplitEditorSheet />
    </>
  );
};
