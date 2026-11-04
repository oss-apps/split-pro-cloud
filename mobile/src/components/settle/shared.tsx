import { type Href } from 'expo-router';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

import { toFixedNumber } from '~/utils/numbers';

import { ModalHeader, Text, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { parseMoneyInput } from '@/lib/money';
import { goBackOr } from '@/lib/navigation';
import { layout, spacing } from '@/theme/tokens';

/** The amount field's text for a balance in cents, e.g. `1250` → `12.5`. */
export const toAmountInput = (cents: number) => toFixedNumber(Math.abs(cents)).toString();

/**
 * Validates what was typed. `value` is in major units (e.g. 12.5): the expense mutations take
 * amounts like the web's forms do, and the server stores them as cents.
 */
export const readAmount = (text: string) => {
  const cents = parseMoneyInput(text);
  return null === cents ? null : toFixedNumber(cents);
};

export interface SettleHeaderProps {
  /** The sheet's title for this step. */
  title: string;
  /** Goes to the previous step; without it the left button closes the sheet. */
  onBack?: () => void;
  /** Shows Save (✓) on the right: the amount step. */
  save?: { onPress: () => void; disabled: boolean; loading: boolean };
}

/**
 * The sheet's native header for the current step: Close or Back on the left, Save on the right,
 * like a system form sheet.
 */
export const SettleHeader: React.FC<SettleHeaderProps> = ({ title, onBack, save }) => {
  const { t } = useTranslation();

  return (
    <ModalHeader
      title={title}
      onBack={onBack}
      onCancel={() => goBackOr()}
      cancelLabel={t('balances.settle.close')}
      confirm={save ? { label: t('balances.settle.save'), ...save } : undefined}
    />
  );
};

/** "Balances changed…": shown above the choice that was dropped. */
export const Notice: React.FC<{ children: string }> = ({ children }) => (
  <Text variant="footnote" color="negative" style={styles.notice} accessibilityRole="alert">
    {children}
  </Text>
);

/**
 * Callbacks for a settle-up mutation: refresh balances, confirm and close the sheet. `fallback` is
 * shown instead when the sheet was opened without anything to go back to (e.g. from a link).
 */
export const useSettleUpCallbacks = (fallback: Href) => {
  const { t } = useTranslation();
  const utils = api.useUtils();

  return {
    onSuccess: useCallback(() => {
      utils.user.invalidate().catch(console.error);
      utils.group.invalidate().catch(console.error);
      // Plays the success haptic.
      toast.success(t('balances.settle.saved'));
      goBackOr(fallback);
    }, [fallback, t, utils]),
    onError: useCallback(
      (error: { message: string }) => {
        toast.error(error.message || t('balances.settle.save_failed'));
      },
      [t],
    ),
  };
};

const styles = StyleSheet.create({
  notice: {
    paddingHorizontal: layout.sectionMargin + layout.rowPadding,
    paddingBottom: spacing[2],
  },
});
