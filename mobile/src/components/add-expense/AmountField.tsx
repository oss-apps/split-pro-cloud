import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, View } from 'react-native';

import { MAX_AMOUNT_CENTS, toUIString } from '~/utils/numbers';

import { Button, Icon, Text, icons } from '@/components/ui';
import { haptics } from '@/lib/haptics';
import { useAddExpenseStore } from '@/store/addExpenseStore';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

import { parseAmountInput, sanitizeAmountInput, toggleAmountSign } from './amountInput';

/**
 * The amount, big and centered like Apple Cash: the currency as a button above it, a refund toggle
 * below (the decimal pad has no minus key) and the amount's error or refund hint.
 */
export const AmountField = forwardRef<
  TextInputInstance,
  {
    isAmountTooLarge: boolean;
    autoFocus: boolean;
    onPressCurrency: () => void;
  }
>(({ isAmountTooLarge, autoFocus, onPressCurrency }, ref) => {
  const { t } = useTranslation();
  const amountStr = useAddExpenseStore((s) => s.amountStr);
  const currency = useAddExpenseStore((s) => s.currency);
  const { setAmount, setAmountStr } = useAddExpenseStore((s) => s.actions);
  const isRefund = amountStr.startsWith('-');

  const onChangeAmount = (text: string) => {
    const cleaned = sanitizeAmountInput(text);
    setAmountStr(cleaned);
    setAmount(parseAmountInput(cleaned));
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPressCurrency}
        accessibilityRole="button"
        accessibilityLabel={t('expense.select_currency')}
        accessibilityValue={{ text: currency }}
        style={({ pressed }) => [styles.currency, pressed ? styles.pressed : null]}
      >
        <Text variant="subheadline" weight="semibold">
          {currency}
        </Text>
        <Icon name={icons.popUp} size={11} weight="semibold" color={colors.secondaryLabel} />
      </Pressable>
      <TextInput
        ref={ref}
        value={amountStr}
        onChangeText={onChangeAmount}
        placeholder={t('expense.amount_hero_placeholder')}
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.tint}
        cursorColor={colors.tint}
        keyboardType="decimal-pad"
        autoFocus={autoFocus}
        accessibilityLabel={t('expense.amount_placeholder')}
        accessibilityHint={currency}
        style={[styles.amount, isAmountTooLarge ? styles.invalid : null]}
      />
      <Button
        size="small"
        variant={isRefund ? 'tinted' : 'gray'}
        icon={icons.refund}
        title={t('expense.refund')}
        onPress={() => {
          haptics.selection();
          onChangeAmount(toggleAmountSign(amountStr));
        }}
        accessibilityLabel={t('expense.toggle_refund')}
        accessibilityRole="switch"
        accessibilityState={{ checked: isRefund }}
      />
      {isAmountTooLarge ? (
        <Text variant="footnote" color="destructive" align="center" style={styles.hint}>
          {t('expense.amount_too_large', { max: toUIString(MAX_AMOUNT_CENTS) })}
        </Text>
      ) : isRefund ? (
        <Text variant="footnote" align="center" style={styles.hint}>
          {t('expense.refund_hint')}
        </Text>
      ) : null}
    </View>
  );
});
AmountField.displayName = 'AmountField';

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: layout.sectionMargin,
    paddingBottom: spacing[6],
  },
  currency: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.full,
    backgroundColor: colors.fill,
  },
  pressed: {
    opacity: 0.6,
  },
  amount: {
    ...typography.largeTitle,
    lineHeight: undefined,
    alignSelf: 'stretch',
    paddingVertical: spacing[1],
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    color: colors.label,
  },
  invalid: {
    color: colors.destructive,
  },
  hint: {
    paddingHorizontal: spacing[4],
  },
});
