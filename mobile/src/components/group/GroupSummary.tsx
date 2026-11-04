import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { getPersonName } from '@/components/expense';
import { Avatar, ListRow, Section, Text, rowInset } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { spacing } from '@/theme/tokens';

type Member = { id: number; name: string | null; email: string | null; image: string | null };
type Balance = { userId: number; firendId: number; currency: string; amount: number };

const MEMBER_AVATAR = 32;

const joinAmounts = (entries: [string, number][]) =>
  entries.map(([currency, amount]) => formatMoney(amount, currency)).join(' + ');

/** The current user's non-zero balances in the group, largest first. */
const getMyBalances = (groupBalances: Balance[], userId: number) =>
  groupBalances
    .filter((balance) => balance.userId === userId && 0 !== balance.amount)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

/**
 * The group's avatar, name and what you lent and owe in it per currency, like the top of a
 * Contacts card (and the web's `GroupMyBalance`).
 */
export const GroupSummary: React.FC<{
  name: string;
  userId: number;
  groupBalances: Balance[];
}> = ({ name, userId, groupBalances }) => {
  const { t } = useTranslation();
  const totals = Object.entries(
    getMyBalances(groupBalances, userId).reduce<Record<string, number>>((acc, balance) => {
      acc[balance.currency] = (acc[balance.currency] ?? 0) + balance.amount;
      return acc;
    }, {}),
  );
  const youLent = totals.filter(([, amount]) => 0 < amount);
  const youOwe = totals.filter(([, amount]) => 0 > amount);

  return (
    <View style={styles.summary}>
      <Avatar name={name} size={88} />
      <Text variant="title1" align="center" numberOfLines={2} accessibilityRole="header">
        {name}
      </Text>
      {youOwe.length ? (
        <Text variant="callout" color="negative" align="center">
          {t('groups.balance_you_owe')}{' '}
          <Text variant="callout" weight="semibold" color="negative" tabular>
            {joinAmounts(youOwe)}
          </Text>
        </Text>
      ) : null}
      {youLent.length ? (
        <Text variant="callout" color="positive" align="center">
          {t('groups.balance_you_lent')}{' '}
          <Text variant="callout" weight="semibold" color="positive" tabular>
            {joinAmounts(youLent)}
          </Text>
        </Text>
      ) : null}
      {!totals.length ? (
        <Text variant="callout" color="secondaryLabel" align="center">
          {t('groups.balance_settled')}
        </Text>
      ) : null}
    </View>
  );
};

/** Who owes you and whom you owe in the group, one row per member and currency. */
export const GroupBalances: React.FC<{
  userId: number;
  groupBalances: Balance[];
  members: Member[];
}> = ({ userId, groupBalances, members }) => {
  const { t } = useTranslation();
  const membersById = new Map(members.map((member) => [member.id, member]));
  const myBalances = getMyBalances(groupBalances, userId);

  if (!myBalances.length) {
    return null;
  }

  return (
    <Section header={t('groups.balances')} separatorInset={rowInset(MEMBER_AVATAR)}>
      {myBalances.map((balance) => {
        const member = membersById.get(balance.firendId);
        const name = member ? getPersonName(member) : t('groups.left_member');
        const isOwed = 0 < balance.amount;

        return (
          <ListRow
            key={`${balance.firendId}-${balance.currency}`}
            left={
              <Avatar
                name={member?.name}
                email={member?.email}
                image={member?.image}
                size={MEMBER_AVATAR}
              />
            }
            title={
              isOwed ? t('groups.member_owes_you', { name }) : t('groups.you_owe_member', { name })
            }
            right={
              <Text color={isOwed ? 'positive' : 'negative'} tabular numberOfLines={1}>
                {formatMoney(balance.amount, balance.currency)}
              </Text>
            }
          />
        );
      })}
    </Section>
  );
};

const styles = StyleSheet.create({
  summary: {
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
  },
});
