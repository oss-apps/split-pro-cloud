import { type Href, Link, router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { type ShareTone, getNetShareLabel } from '~/utils/expenseLabels';

import { Icon, ListRow, Text, icons } from '@/components/ui';
import { formatMoney, formatSignedMoney } from '@/lib/money';
import { type ColorName, colors, radii, spacing } from '@/theme/tokens';

import { CategoryIcon } from './categoryIcons';
import { MonthHeader, formatShortDate } from './ExpenseListDate';

type Person = { id: number; name?: string | null; email?: string | null };

export interface ExpenseListItemExpense {
  id: string;
  name: string;
  category: string;
  /** Integer cents. Negative for refunds. */
  amount: number;
  currency: string;
  expenseDate: Date;
  splitType: string;
  recurringId?: number | null;
  groupId?: number | null;
}

export interface ExpenseListItemProps {
  expense: ExpenseListItemExpense;
  currentUserId: number;
  /** Who paid. Only `id` is needed when it's the current user. */
  paidBy: Person;
  /** The other side of a settlement, shown as "Alice paid Bob". Leave out in a friend's list. */
  receiver?: Person | null;
  /** Shown on settlements as "in Holiday Trip", e.g. in a friend's list. */
  groupName?: string | null;
  /**
   * The current user's net amount in cents (`getNetWithFriend` or `getNetForUser` from
   * ~/utils/expenseLabels): positive when they lent, negative when they owe, `undefined` when not
   * involved.
   */
  net: number | undefined;
  /**
   * @deprecated Renders a month header above the row. Prefer a SectionList with one section per
   * month (see the friend screen).
   */
  showMonthHeader?: boolean;
  /** Defaults to opening the expense. */
  onPress?: () => void;
}

const TONE_COLORS: Record<ShareTone, ColorName> = {
  lent: 'positive',
  owe: 'negative',
  none: 'secondaryLabel',
};

/** Size of the category tile at the start of the row, for separator insets. */
export const EXPENSE_ICON_SIZE = 36;

export const getPersonName = (person: Person) => person.name ?? person.email ?? '';

const expenseHref = (expense: Pick<ExpenseListItemExpense, 'id' | 'groupId'>) =>
  ({
    pathname: '/expenses/[expenseId]',
    params: {
      expenseId: expense.id,
      ...(expense.groupId ? { groupId: String(expense.groupId) } : {}),
    },
  }) as Href;

export const openExpense = (expense: Pick<ExpenseListItemExpense, 'id' | 'groupId'>) =>
  router.push(expenseHref(expense));

/**
 * One expense in the friend, group and activity lists: category, name, who paid and when, and the
 * current user's share. Settlements show who paid whom instead, like the web.
 */
export const ExpenseListItem: React.FC<ExpenseListItemProps> = ({
  expense,
  currentUserId,
  paidBy,
  receiver,
  groupName,
  net,
  showMonthHeader,
  onPress,
}) => {
  const { t } = useTranslation();
  const isSettlement = 'SETTLEMENT' === expense.splitType;
  const youPaid = paidBy.id === currentUserId;
  const amount = formatSignedMoney(expense.amount, expense.currency);

  const share = getNetShareLabel(net);
  const shareLabel = {
    lent: t('balances.expense.you_lent'),
    owe: t('balances.expense.you_owe'),
    none: undefined === net ? t('balances.expense.not_involved') : t('balances.expense.no_balance'),
  }[share.tone];

  const payment = (() => {
    if (!receiver) {
      return youPaid
        ? t('balances.expense.you_paid', { amount })
        : t('balances.expense.paid', { name: getPersonName(paidBy), amount });
    }

    if (youPaid) {
      return t('balances.expense.you_paid_to', { name: getPersonName(receiver), amount });
    }

    return receiver.id === currentUserId
      ? t('balances.expense.paid_you', { name: getPersonName(paidBy), amount })
      : t('balances.expense.paid_to', {
          payer: getPersonName(paidBy),
          receiver: getPersonName(receiver),
          amount,
        });
  })();
  const description =
    isSettlement && groupName
      ? `${payment} ${t('balances.expense.in_group', { group: groupName })}`
      : payment;
  const date = formatShortDate(expense.expenseDate);

  const row = (
    <ListRow
      onPress={onPress ?? (() => openExpense(expense))}
      left={
        <View style={[styles.tile, isSettlement ? styles.settlementTile : null]}>
          {isSettlement ? (
            <Icon name={icons.settle} size={17} color={colors.positive} weight="semibold" />
          ) : (
            <CategoryIcon category={expense.category} color={colors.secondaryLabel} size={19} />
          )}
        </View>
      }
      title={
        isSettlement ? (
          <Text variant="subheadline" color="secondaryLabel" numberOfLines={2}>
            {description}
          </Text>
        ) : (
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {expense.name}
            </Text>
            {expense.recurringId ? (
              <Icon
                name={icons.repeat}
                size={13}
                color={colors.secondaryLabel}
                accessibilityLabel={t('balances.expense.repeats')}
              />
            ) : null}
          </View>
        )
      }
      subtitle={
        isSettlement ? (
          <Text variant="subheadline" color="secondaryLabel" numberOfLines={1}>
            {date}
          </Text>
        ) : (
          // The date never shrinks: only who paid is cut short when the row is narrow.
          <View style={styles.subtitleRow}>
            <Text variant="subheadline" color="secondaryLabel" style={styles.date}>
              {`${date} · `}
            </Text>
            <Text
              variant="subheadline"
              color="secondaryLabel"
              numberOfLines={1}
              style={styles.payment}
            >
              {description}
            </Text>
          </View>
        )
      }
      right={
        isSettlement ? null : (
          <View style={styles.share}>
            <Text variant="footnote" color={TONE_COLORS[share.tone]} align="right">
              {shareLabel}
            </Text>
            <Text
              weight="semibold"
              color={TONE_COLORS[share.tone]}
              align="right"
              tabular
              numberOfLines={1}
            >
              {formatMoney(share.amount, expense.currency)}
            </Text>
          </View>
        )
      }
    />
  );

  return (
    <View>
      {showMonthHeader ? <MonthHeader date={expense.expenseDate} /> : null}
      {/* A custom onPress means the screen decides what the row opens: no peek or menu then */}
      {onPress || 'ios' !== Platform.OS ? (
        row
      ) : (
        <Link href={expenseHref(expense)} asChild>
          <Link.Trigger>{row}</Link.Trigger>
          <Link.Preview />
          <Link.Menu>
            <Link.MenuAction
              title={t('balances.expense.open')}
              icon={icons.receipt.ios}
              onPress={() => openExpense(expense)}
            />
            <Link.MenuAction
              title={t('expense.detail.edit')}
              icon={icons.edit.ios}
              hidden={isSettlement}
              onPress={() => router.push({ pathname: '/add', params: { expenseId: expense.id } })}
            />
          </Link.Menu>
        </Link>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: EXPENSE_ICON_SIZE,
    height: EXPENSE_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.tertiaryFill,
  },
  settlementTile: {
    borderRadius: EXPENSE_ICON_SIZE / 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  title: {
    flexShrink: 1,
  },
  subtitleRow: {
    flexDirection: 'row',
  },
  date: {
    flexShrink: 0,
  },
  payment: {
    flexShrink: 1,
  },
  share: {
    flexShrink: 0,
    maxWidth: '45%',
    alignItems: 'flex-end',
  },
});
