import { SplitType } from '@prisma/client';
import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { formatShortDate } from '~/utils/dates';
import { type ShareTone, getNetShareLabel } from '~/utils/expenseLabels';

import { CategoryIcon, EXPENSE_ICON_SIZE, getPersonName, openExpense } from '@/components/expense';
import { Icon, ListRow, Text, icons } from '@/components/ui';
import { getDeviceLocale } from '@/i18n';
import { type RouterOutputs } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import { type ColorName, colors, radii, spacing } from '@/theme/tokens';

export type ActivityEntry = RouterOutputs['user']['getAllExpenses'][number];

const TONE_COLORS: Record<ShareTone, ColorName> = {
  lent: 'positive',
  owe: 'negative',
  none: 'secondaryLabel',
};

const SHARE_KEYS = {
  lent: 'activity.you_lent',
  owe: 'activity.you_owe',
  none: 'activity.no_balance',
} as const;

export interface ActivityItemProps {
  entry: ActivityEntry;
  currentUserId: number;
  /** Hides the date when the section header already says it. */
  showDate: boolean;
}

const bold = <Text weight="semibold" color="label" />;

/**
 * One line of the activity feed, worded like the web's src/pages/activity.tsx: the category, what
 * happened, and the current user's share. Deleted expenses are struck through in secondary text.
 */
export const ActivityItem: React.FC<ActivityItemProps> = ({ entry, currentUserId, showDate }) => {
  const { t } = useTranslation();
  const { expense } = entry;
  const nameOf = (person: { id: number; name: string | null; email: string | null }) =>
    person.id === currentUserId ? t('activity.you') : getPersonName(person);
  const isSettlement = SplitType.SETTLEMENT === expense.splitType;
  const isDeleted = !!expense.deletedBy;

  const sentence = expense.deletedByUser ? (
    <Text color="secondaryLabel" numberOfLines={2}>
      <Trans
        i18nKey="activity.deleted"
        values={{ name: nameOf(expense.deletedByUser), expense: expense.name }}
        components={{
          b: <Text weight="semibold" color="secondaryLabel" />,
          s: <Text color="secondaryLabel" style={styles.strike} />,
        }}
      />
    </Text>
  ) : (
    <Text numberOfLines={2}>
      {isSettlement ? (
        <Trans
          i18nKey={expense.group ? 'activity.settled_up_in' : 'activity.settled_up'}
          values={{ name: nameOf(expense.paidByUser), group: expense.group?.name }}
          components={{ b: bold }}
        />
      ) : (
        <Trans
          i18nKey="activity.paid_for"
          values={{ name: nameOf(expense.paidByUser), expense: expense.name }}
          components={{ b: bold }}
        />
      )}
    </Text>
  );

  const payment = (() => {
    if (isDeleted) {
      return null;
    }

    if (isSettlement) {
      const youPaid = expense.paidBy === currentUserId;
      return (
        <Text variant="subheadline" color={youPaid ? 'positive' : 'negative'}>
          {t(youPaid ? 'activity.you_paid' : 'activity.you_received', {
            amount: formatMoney(expense.amount, expense.currency),
          })}
        </Text>
      );
    }

    const share = getNetShareLabel(entry.amount);
    return (
      <Text variant="subheadline" color={TONE_COLORS[share.tone]}>
        {t(SHARE_KEYS[share.tone], { amount: formatMoney(share.amount, expense.currency) })}
      </Text>
    );
  })();

  const tile = (() => {
    if (isDeleted) {
      return <Icon name={icons.trash} size={17} color={colors.tertiaryLabel} />;
    }

    if (isSettlement) {
      return <Icon name={icons.settle} size={17} color={colors.positive} weight="semibold" />;
    }

    return <CategoryIcon category={expense.category} color={colors.secondaryLabel} size={19} />;
  })();

  return (
    <ListRow
      onPress={() => openExpense({ id: expense.id, groupId: expense.groupId })}
      left={
        <View style={[styles.tile, isSettlement && !isDeleted ? styles.round : null]}>{tile}</View>
      }
      title={sentence}
      subtitle={
        payment || showDate || expense.recurringId ? (
          <View style={styles.subtitle}>
            {payment}
            {showDate || expense.recurringId ? (
              <View style={styles.meta}>
                {showDate ? (
                  <Text variant="footnote">
                    {formatShortDate(expense.expenseDate, new Date(), getDeviceLocale())}
                  </Text>
                ) : null}
                {expense.recurringId ? (
                  <Icon
                    name={icons.repeat}
                    size={12}
                    color={colors.secondaryLabel}
                    accessibilityLabel={t('activity.recurring')}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : undefined
      }
      accessory="chevron"
    />
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
  round: {
    borderRadius: EXPENSE_ICON_SIZE / 2,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  subtitle: {
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
});
