import { Link, router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { getGroupBalanceSummary } from '~/utils/balances';

import { Avatar, ListRow, Text, icons } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { layout, spacing } from '@/theme/tokens';

import { shareInviteLink } from './invite';

export interface GroupBalanceRowProps {
  group: {
    id: number;
    name: string;
    publicId: string;
    defaultCurrency: string;
    balances: Record<string, number>;
  };
}

/**
 * A group in the Groups tab with your largest balance in it, like the web's `GroupBalance`. On iOS
 * it peeks the group on a long press, with a menu: open, add expense, settle up, share invite.
 */
export const GroupBalanceRow: React.FC<GroupBalanceRowProps> = ({ group }) => {
  const { t } = useTranslation();
  const { amount, currency, multiCurrency } = getGroupBalanceSummary(
    group.balances,
    group.defaultCurrency,
  );
  const color = 0 < amount ? 'positive' : 'negative';
  const params = { groupId: String(group.id) };
  const openGroup = () => router.push({ pathname: '/groups/[groupId]', params });

  const row = (
    <ListRow
      left={<Avatar name={group.name} size={layout.rowAvatar} />}
      title={group.name}
      accessory="chevron"
      onPress={openGroup}
      right={
        0 === amount ? (
          <Text variant="subheadline" color="secondaryLabel">
            {t('groups.settled_up')}
          </Text>
        ) : (
          <View style={styles.amount}>
            <Text variant="footnote" color={color} align="right">
              {0 < amount ? t('groups.you_lent') : t('groups.you_owe')}
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
              {multiCurrency ? (
                <Text color={color} accessibilityLabel={t('groups.multi_currency_hint')}>
                  {' *'}
                </Text>
              ) : null}
            </Text>
          </View>
        )
      }
    />
  );

  if ('ios' !== Platform.OS) {
    return row;
  }

  return (
    <Link href={{ pathname: '/groups/[groupId]', params }} asChild>
      <Link.Trigger>{row}</Link.Trigger>
      <Link.Preview />
      <Link.Menu>
        <Link.MenuAction
          title={t('groups.open_group')}
          icon={icons.groups.ios}
          onPress={openGroup}
        />
        <Link.MenuAction
          title={t('groups.add_expense')}
          icon={icons.add.ios}
          onPress={() => router.push({ pathname: '/add', params })}
        />
        <Link.MenuAction
          title={t('groups.settle_up')}
          icon={icons.settle.ios}
          hidden={0 === amount}
          onPress={() => router.push({ pathname: '/settle-up', params })}
        />
        <Link.MenuAction
          title={t('groups.share_invite_link')}
          icon={icons.share.ios}
          onPress={() => void shareInviteLink(group, t)}
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
