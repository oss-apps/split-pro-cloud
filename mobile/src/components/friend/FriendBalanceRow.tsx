import { Link, router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { Avatar, ListRow, type ListRowProps, Text, icons } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { layout, spacing } from '@/theme/tokens';

type FriendLike = { name?: string | null; email?: string | null; image?: string | null };

export interface FriendBalanceRowProps {
  friend: FriendLike;
  /** Integer cents, from the current user's side: positive means the friend owes them. */
  amount: number;
  currency: string;
  /** The friend also has balances in other currencies (the web's `*`). */
  hasMore?: boolean;
  onPress?: () => void;
  /**
   * Makes the row a link to the friend's page with a peek preview and a long-press menu (Add
   * expense, Settle up) on iOS. `onPress` is ignored then.
   */
  friendId?: number;
  avatarSize?: number;
  /** Replaces "Settled up" for a zero amount. */
  zeroLabel?: string;
  accessory?: ListRowProps['accessory'];
  /** @deprecated Use `accessory="chevron"`. */
  showChevron?: boolean;
  /** @deprecated Separators come from the list (`ItemSeparatorComponent`) or `Section`. */
  divider?: boolean;
}

/** A friend with "you get"/"you owe" and the amount, in the balances list and settle-up. */
export const FriendBalanceRow: React.FC<FriendBalanceRowProps> = ({
  friend,
  amount,
  currency,
  hasMore,
  onPress,
  friendId,
  avatarSize = layout.rowAvatar,
  zeroLabel,
  accessory,
  showChevron,
  divider,
}) => {
  const { t } = useTranslation();
  const color = 0 < amount ? 'positive' : 'negative';
  const name = friend.name ?? friend.email ?? '';

  const row = (
    <ListRow
      title={name}
      left={
        <Avatar name={friend.name} email={friend.email} image={friend.image} size={avatarSize} />
      }
      right={
        0 === amount ? (
          <Text variant="subheadline" color="secondaryLabel">
            {zeroLabel ?? t('balances.settled_up')}
          </Text>
        ) : (
          <View style={styles.amount}>
            <Text variant="footnote" color={color} align="right">
              {0 < amount ? t('balances.you_get_short') : t('balances.you_owe_short')}
            </Text>
            <Text
              variant="body"
              weight="semibold"
              color={color}
              align="right"
              tabular
              numberOfLines={1}
            >
              {formatMoney(amount, currency)}
              {hasMore ? (
                <Text color={color} accessibilityLabel={t('balances.more_currencies')}>
                  {' *'}
                </Text>
              ) : null}
            </Text>
          </View>
        )
      }
      onPress={onPress}
      accessory={accessory}
      showChevron={showChevron}
      divider={divider}
    />
  );

  if (undefined === friendId || 'ios' !== Platform.OS) {
    return row;
  }

  const params = { friendId: String(friendId) };

  return (
    <Link href={{ pathname: '/balances/[friendId]', params }} asChild>
      <Link.Trigger>{row}</Link.Trigger>
      <Link.Preview />
      <Link.Menu>
        <Link.MenuAction
          title={t('balances.friend.add_expense')}
          icon={icons.add.ios}
          onPress={() => router.push({ pathname: '/add', params })}
        />
        <Link.MenuAction
          title={t('balances.friend.settle_up')}
          icon={icons.settle.ios}
          hidden={0 === amount}
          onPress={() => router.push({ pathname: '/settle-up', params })}
        />
      </Link.Menu>
    </Link>
  );
};

const styles = StyleSheet.create({
  amount: {
    alignItems: 'flex-end',
    paddingLeft: spacing[2],
  },
});
