import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { Avatar, Icon, Section, Text, icons } from '@/components/ui';
import { colors, fontWeights, spacing, typography } from '@/theme/tokens';

import { PaymentDate } from './PaymentDate';

type PaymentUser = { name?: string | null; email?: string | null; image?: string | null };

export interface SettleUpPaymentProps {
  currentUser: PaymentUser;
  friend: PaymentUser;
  isCurrentUserPaying: boolean;
  currency: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  /** Set when the amount can't be saved. */
  amountError?: string | null;
  date: string;
  onDateChange: (date: string) => void;
  /** Shown between the amount and the date, e.g. where the payment goes. */
  children?: React.ReactNode;
}

/**
 * Who pays whom and a big editable amount, like Apple Cash, then the day it was paid. Shared by
 * the friend and group settle-up flows, like the web's src/components/Friend/SettleUpPayment.tsx.
 */
export const SettleUpPayment: React.FC<SettleUpPaymentProps> = ({
  currentUser,
  friend,
  isCurrentUserPaying,
  currency,
  amount,
  onAmountChange,
  amountError,
  date,
  onDateChange,
  children,
}) => {
  const { t } = useTranslation();
  const payer = isCurrentUserPaying ? currentUser : friend;
  const receiver = isCurrentUserPaying ? friend : currentUser;
  const friendName = friend.name ?? friend.email ?? '';

  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.avatars}>
          <Avatar name={payer.name} email={payer.email} image={payer.image} size={56} />
          <Icon name={icons.arrowRight} size={20} color={colors.tertiaryLabel} weight="semibold" />
          <Avatar name={receiver.name} email={receiver.email} image={receiver.image} size={56} />
        </View>
        <Text variant="subheadline" color="secondaryLabel" align="center">
          {isCurrentUserPaying
            ? t('balances.settle.you_are_paying', { name: friendName })
            : t('balances.settle.is_paying_you', { name: friendName })}
        </Text>
        <View style={styles.amountRow}>
          <Text variant="title2" color="secondaryLabel">
            {currency.toUpperCase()}
          </Text>
          <TextInput
            value={amount}
            onChangeText={onAmountChange}
            keyboardType="decimal-pad"
            inputMode="decimal"
            selectionColor={colors.tint}
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            accessibilityLabel={t('balances.settle.amount')}
            style={[styles.amountInput, amountError ? styles.amountInvalid : null]}
            selectTextOnFocus
          />
        </View>
        {amountError ? (
          <Text variant="footnote" color="destructive" align="center">
            {amountError}
          </Text>
        ) : null}
      </View>

      {children}

      <Section>
        <PaymentDate value={date} onChange={onDateChange} />
      </Section>
    </View>
  );
};

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[6],
  },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    marginBottom: spacing[1],
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  amountInput: {
    ...typography.largeTitle,
    minWidth: 80,
    maxWidth: 240,
    paddingVertical: spacing[1],
    color: colors.label,
    fontWeight: fontWeights.bold,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  amountInvalid: {
    color: colors.destructive,
  },
});
