import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { type ColorName, colors, radii, spacing } from '@/theme/tokens';

type Total = { currency: string; amount: number };

/** "USD 12.00 + EUR 3.00", without signs. */
export const joinAmounts = (totals: Total[]) =>
  totals.map((total) => formatMoney(total.amount, total.currency)).join(' + ');

const TotalTile: React.FC<{ title: string; totals: Total[]; color: ColorName }> = ({
  title,
  totals: unsorted,
  color,
}) => {
  // The server returns currencies in no fixed order; sort so the lines don't swap between loads.
  const totals = [...unsorted].sort((a, b) => a.currency.localeCompare(b.currency));

  return (
    <View style={styles.tile} accessible accessibilityLabel={`${title}: ${joinAmounts(totals)}`}>
      <Text variant="subheadline" weight="medium" color="secondaryLabel">
        {title}
      </Text>
      {totals.map((total) => (
        <Text
          key={total.currency}
          variant="title3"
          color={color}
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {formatMoney(total.amount, total.currency)}
        </Text>
      ))}
    </View>
  );
};

/**
 * The "You owe" and "You get" totals at the top of the balances tab, one line per currency, as
 * summary tiles (like Health or Wallet).
 */
export const BalanceTotals: React.FC<{ youOwe: Total[]; youGet: Total[] }> = ({
  youOwe,
  youGet,
}) => {
  const { t } = useTranslation();

  if (!youOwe.length && !youGet.length) {
    return null;
  }

  return (
    <View style={styles.row}>
      {youOwe.length ? (
        <TotalTile title={t('balances.you_owe')} totals={youOwe} color="negative" />
      ) : null}
      {youGet.length ? (
        <TotalTile title={t('balances.you_get')} totals={youGet} color="positive" />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  tile: {
    flex: 1,
    gap: spacing[1],
    padding: spacing[4],
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.secondaryBackground,
  },
});
