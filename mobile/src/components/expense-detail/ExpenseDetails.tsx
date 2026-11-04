import { SplitType } from '@prisma/client';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { CategoryIcon } from '@/components/expense';
import {
  Avatar,
  Icon,
  type IconName,
  ListRow,
  Money,
  Section,
  Text,
  icons,
  rowInset,
} from '@/components/ui';
import { type RouterOutputs } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { formatMoney, formatSignedMoney } from '@/lib/money';
import { type ColorName, colors, radii, spacing } from '@/theme/tokens';

import { type ParticipantLine, getParticipantLines, getShareTone } from './expenseDetail';
import { ReceiptRow } from './ReceiptImage';
import { ExpenseRecurringRule } from './RecurringRule';

type Expense = RouterOutputs['user']['getExpenseDetails'];

const AVATAR_SIZE = 32;
const HERO_TILE_SIZE = 64;

const TONE_COLORS: Record<ReturnType<typeof getShareTone>, ColorName> = {
  lent: 'positive',
  owe: 'negative',
  none: 'label',
};

const nameOf = (user: { name: string | null; email: string | null }) =>
  user.name ?? user.email ?? '';

/** A deleted expense, or one the user only sees as a group member: like ContentUnavailableView. */
const StatusNotice: React.FC<{ icon: IconName; title: string; description: string }> = ({
  icon,
  title,
  description,
}) => (
  <View style={styles.notice} accessible accessibilityLabel={`${title}. ${description}`}>
    <Icon name={icon} size={28} color={colors.secondaryLabel} />
    <Text variant="headline" align="center">
      {title}
    </Text>
    <Text variant="subheadline" color="secondaryLabel" align="center">
      {description}
    </Text>
  </View>
);

const PersonRow: React.FC<{
  user: { name: string | null; email: string | null; image: string | null };
  isYou: boolean;
  subtitle?: string;
  right: React.ReactNode;
}> = ({ user, isYou, subtitle, right }) => {
  const { t } = useTranslation();

  return (
    <ListRow
      left={<Avatar name={user.name} email={user.email} image={user.image} size={AVATAR_SIZE} />}
      title={isYou ? t('expense.detail.you_name', { name: nameOf(user) }) : nameOf(user)}
      subtitle={subtitle}
      right={right}
    />
  );
};

const ShareRow: React.FC<{ line: ParticipantLine; expense: Expense; userId: number }> = ({
  line,
  expense,
  userId,
}) => {
  const { t } = useTranslation();
  const amount = 'share' === line.kind ? line.share : line.amount;
  const color = TONE_COLORS[getShareTone(line, expense.paidBy, userId)];
  const subtitle =
    'received' === line.kind
      ? t('expense.detail.share_received')
      : 0 > line.share
        ? t('expense.detail.share_gets_back')
        : t('expense.detail.share_owes');

  return (
    <PersonRow
      user={line.user}
      isYou={line.isYou}
      subtitle={subtitle}
      right={
        <Text color={color} weight="semibold" tabular numberOfLines={1}>
          {formatMoney(amount, expense.currency)}
        </Text>
      }
    />
  );
};

/** The expense like a Wallet transaction: a header, then inset-grouped sections. */
export const ExpenseDetails: React.FC<{ expense: Expense; userId: number }> = ({
  expense,
  userId,
}) => {
  const { t } = useTranslation();
  const isSettlement = SplitType.SETTLEMENT === expense.splitType;
  const total = formatSignedMoney(expense.amount, expense.currency);
  const lines = getParticipantLines(expense, userId);
  const isInvolved =
    userId === expense.paidBy ||
    expense.expenseParticipants.some((participant) => userId === participant.userId);
  const separatorInset = rowInset(AVATAR_SIZE);

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={[styles.tile, isSettlement ? styles.settlementTile : null]}>
          {isSettlement ? (
            <Icon name={icons.settle} size={28} color={colors.positive} weight="semibold" />
          ) : (
            <CategoryIcon category={expense.category} color={colors.secondaryLabel} size={30} />
          )}
        </View>
        <Text variant="title3" align="center" accessibilityRole="header">
          {expense.name}
        </Text>
        <Text variant="largeTitle" align="center" tabular accessibilityLabel={total}>
          {total}
        </Text>
        <Text variant="subheadline" color="secondaryLabel" align="center">
          {formatDate(expense.expenseDate)}
        </Text>
      </View>

      {expense.deletedByUser ? (
        <StatusNotice
          icon={icons.trash}
          title={t('expense.detail.deleted_title')}
          description={t('expense.detail.deleted_by', {
            name: nameOf(expense.deletedByUser),
            date: formatDate(expense.deletedAt ?? expense.createdAt),
          })}
        />
      ) : !isInvolved ? (
        <StatusNotice
          icon={icons.personMissing}
          title={t('expense.detail.not_involved_title')}
          description={t('expense.detail.not_involved_description')}
        />
      ) : null}

      <Section header={t('expense.detail.paid_by')}>
        <PersonRow
          user={expense.paidByUser}
          isYou={userId === expense.paidBy}
          right={
            <Money
              amount={expense.amount}
              currency={expense.currency}
              mode="signed"
              weight="semibold"
              numberOfLines={1}
            />
          }
        />
      </Section>

      {lines.length ? (
        <Section
          header={
            isSettlement
              ? t('expense.detail.received_by')
              : t(`expense.split_types.${expense.splitType as Exclude<SplitType, 'SETTLEMENT'>}`)
          }
          separatorInset={separatorInset}
        >
          {lines.map((line) => (
            <ShareRow key={line.user.id} line={line} expense={expense} userId={userId} />
          ))}
        </Section>
      ) : null}

      {expense.group ? (
        <Section>
          <ListRow
            left={<Icon name={icons.groups} size={20} color={colors.tint} />}
            title={t('expense.detail.group')}
            detail={expense.group.name}
            accessory="chevron"
            onPress={() =>
              router.push({
                pathname: '/groups/[groupId]',
                params: { groupId: String(expense.groupId) },
              })
            }
          />
        </Section>
      ) : null}

      {expense.recurringId ? <ExpenseRecurringRule ruleId={expense.recurringId} /> : null}

      {expense.fileKey ? (
        <Section>
          <ReceiptRow fileKey={expense.fileKey} />
        </Section>
      ) : null}

      <View style={styles.footer}>
        <Text variant="footnote" align="center">
          {t('expense.detail.added_by', {
            name: nameOf(expense.addedByUser),
            date: formatDate(expense.createdAt),
          })}
        </Text>
        {expense.updatedByUser ? (
          <Text variant="footnote" align="center">
            {t('expense.detail.edited_by', {
              name: nameOf(expense.updatedByUser),
              date: formatDate(expense.updatedAt),
            })}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing[8],
  },
  hero: {
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
  tile: {
    width: HERO_TILE_SIZE,
    height: HERO_TILE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.secondaryGroupedBackground,
  },
  settlementTile: {
    borderRadius: HERO_TILE_SIZE / 2,
  },
  notice: {
    alignItems: 'center',
    gap: spacing[1],
    marginHorizontal: spacing[4],
    marginBottom: spacing[6],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[5],
    borderRadius: radii.section,
    borderCurve: 'continuous',
    backgroundColor: colors.secondaryGroupedBackground,
  },
  footer: {
    gap: spacing[1],
    paddingHorizontal: spacing[8],
  },
});
