import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Avatar, ListRow, Section, Text } from '@/components/ui';
import { type RouterOutputs } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { type ColorName, spacing } from '@/theme/tokens';

import { joinAmounts } from './BalanceTotals';

type Friend = NonNullable<RouterOutputs['user']['getFriend']>;
type Balance = RouterOutputs['user']['getBalancesWithFriend'][number];
type Breakdown = RouterOutputs['user']['getBalanceBreakdownWithFriend'];

/** The friend's avatar, name and "You owe … / You lent …", like the top of a Contacts card. */
export const FriendSummary: React.FC<{ friend: Friend; balances: Balance[] }> = ({
  friend,
  balances,
}) => {
  const { t } = useTranslation();
  const youLent = balances.filter((balance) => 0 < balance.amount);
  const youOwe = balances.filter((balance) => 0 > balance.amount);

  return (
    <View style={styles.summary}>
      <Avatar name={friend.name} email={friend.email} image={friend.image} size={88} />
      <Text variant="title1" align="center" numberOfLines={2} accessibilityRole="header">
        {friend.name ?? friend.email}
      </Text>
      {youOwe.length ? (
        <Text variant="callout" color="negative" align="center">
          {t('balances.you_owe')}{' '}
          <Text variant="callout" weight="semibold" color="negative" tabular>
            {joinAmounts(youOwe)}
          </Text>
        </Text>
      ) : null}
      {youLent.length ? (
        <Text variant="callout" color="positive" align="center">
          {t('balances.you_lent')}{' '}
          <Text variant="callout" weight="semibold" color="positive" tabular>
            {joinAmounts(youLent)}
          </Text>
        </Text>
      ) : null}
      {!youOwe.length && !youLent.length ? (
        <Text variant="callout" color="secondaryLabel" align="center">
          {t('balances.friend.all_settled')}
        </Text>
      ) : null}
    </View>
  );
};

const signedLabel = (
  amount: number,
  currency: string,
  t: ReturnType<typeof useTranslation>['t'],
) => {
  if (0 === amount) {
    return t('balances.settle.settled');
  }

  const formatted = formatMoney(amount, currency);
  return 0 < amount
    ? t('balances.settle.you_get_amount', { amount: formatted })
    : t('balances.settle.you_owe_amount', { amount: formatted });
};

const amountColor = (amount: number): ColorName =>
  0 === amount ? 'secondaryLabel' : 0 < amount ? 'positive' : 'negative';

/**
 * Where the balance with this friend comes from, each shared group and outside groups: one
 * inset-grouped section per currency.
 */
export const BalanceBreakdown: React.FC<{ breakdown: Breakdown }> = ({ breakdown }) => {
  const { t } = useTranslation();
  const withGroups = breakdown.filter((currency) => currency.groups.length);

  if (!withGroups.length) {
    return null;
  }

  // One child, so a parent's `gap` doesn't add to the sections' own spacing.
  return (
    <View>
      {withGroups.map((currency) => (
        <Section
          key={currency.currency}
          header={
            1 < withGroups.length
              ? `${t('balances.friend.breakdown')} · ${currency.currency.toUpperCase()}`
              : t('balances.friend.breakdown')
          }
        >
          {currency.groups.map((group) => (
            <BreakdownRow
              key={group.groupId}
              label={group.name ?? t('balances.friend.group_you_left')}
              amount={group.amount}
              currency={currency.currency}
            />
          ))}
          {0 !== currency.nonGroup ? (
            <BreakdownRow
              label={t('balances.friend.outside_groups')}
              amount={currency.nonGroup}
              currency={currency.currency}
            />
          ) : null}
        </Section>
      ))}
    </View>
  );
};

const BreakdownRow: React.FC<{ label: string; amount: number; currency: string }> = ({
  label,
  amount,
  currency,
}) => {
  const { t } = useTranslation();

  return (
    <ListRow
      title={label}
      right={
        <Text variant="subheadline" color={amountColor(amount)} tabular numberOfLines={1}>
          {signedLabel(amount, currency, t)}
        </Text>
      }
    />
  );
};

const styles = StyleSheet.create({
  summary: {
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
  },
});
