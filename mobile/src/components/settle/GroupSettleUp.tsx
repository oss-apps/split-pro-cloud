import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseDateInput } from '~/utils/dates';

import { useCurrentUser } from '@/components/expense';
import { FriendBalanceRow } from '@/components/friend/FriendBalanceRow';
import {
  EmptyState,
  FullScreenSpinner,
  Icon,
  ListRow,
  Section,
  icons,
  rowInset,
} from '@/components/ui';
import { type RouterOutputs, api } from '@/lib/api';
import { colors } from '@/theme/tokens';

import { SettleUpPayment } from './SettleUpPayment';
import { Notice, SettleHeader, readAmount, toAmountInput, useSettleUpCallbacks } from './shared';

type GroupBalance = NonNullable<RouterOutputs['group']['getGroupDetails']>['groupBalances'][number];
type Selection = Pick<GroupBalance, 'firendId' | 'currency' | 'amount'>;

/**
 * Port of the web's src/components/group/GroupSettleUp.tsx: records a payment between the current
 * user and one member, inside this group only. `friendId` narrows the choice to that member.
 */
export const GroupSettleUp: React.FC<{ groupId: number; friendId?: number }> = ({
  groupId,
  friendId,
}) => {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const groupQuery = api.group.getGroupDetails.useQuery({ groupId });
  const addGroupExpenseMutation = api.group.addOrEditExpense.useMutation();
  const callbacks = useSettleUpCallbacks({
    pathname: '/groups/[groupId]',
    params: { groupId: String(groupId) },
  });

  const members = groupQuery.data?.groupUsers.map((groupUser) => groupUser.user) ?? [];
  const membersById = new Map(members.map((member) => [member.id, member]));
  const balances = (groupQuery.data?.groupBalances ?? [])
    .filter(
      (b) =>
        b.userId === currentUser?.id &&
        0 !== b.amount &&
        (undefined === friendId || b.firendId === friendId),
    )
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Keep only what was picked, so what is shown and paid always comes from the latest balances.
  const [selection, setSelection] = useState<Selection | undefined>();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [initialized, setInitialized] = useState(false);

  const currentBalance = selection
    ? balances.find((b) => b.firendId === selection.firendId && b.currency === selection.currency)
    : undefined;
  // A balance that is gone or now goes the other way is never paid with the old direction.
  const isStale =
    !!selection &&
    (!currentBalance || Math.sign(currentBalance.amount) !== Math.sign(selection.amount));
  const balanceToSettle = isStale ? undefined : currentBalance;
  const selectionChanged = isStale;
  const friend = balanceToSettle ? membersById.get(balanceToSettle.firendId) : undefined;
  const isCurrentUserPaying = 0 > (balanceToSettle?.amount ?? 0);
  const value = readAmount(amount);
  const canSave =
    !!balanceToSettle && !!friend && null !== value && !addGroupExpenseMutation.isLoading;

  const selectBalance = (balance: GroupBalance | undefined) => {
    setSelection(
      balance
        ? { firendId: balance.firendId, currency: balance.currency, amount: balance.amount }
        : undefined,
    );
    setAmount(balance ? toAmountInput(balance.amount) : '');
  };

  // With a single balance there is nothing to choose, so open straight on the payment.
  const [firstBalance] = balances;
  if (!initialized && groupQuery.data && currentUser) {
    setInitialized(true);
    if (1 === balances.length && firstBalance && membersById.has(firstBalance.firendId)) {
      selectBalance(firstBalance);
    }
  }

  const save = () => {
    if (!canSave || !balanceToSettle || !friend || null === value || !currentUser) {
      return;
    }

    addGroupExpenseMutation.mutate(
      {
        groupId,
        name: 'Settle up',
        currency: balanceToSettle.currency,
        amount: value,
        splitType: 'SETTLEMENT',
        participants: [
          { userId: currentUser.id, amount: isCurrentUserPaying ? value : -value },
          { userId: friend.id, amount: isCurrentUserPaying ? -value : value },
        ],
        paidBy: isCurrentUserPaying ? currentUser.id : friend.id,
        category: 'general',
        expenseDate: parseDateInput(date),
      },
      callbacks,
    );
  };

  const title = t('screens.settle_up');

  if (groupQuery.isLoading || !currentUser) {
    return (
      <>
        <SettleHeader title={title} />
        <FullScreenSpinner grouped />
      </>
    );
  }

  if (groupQuery.isError || !groupQuery.data) {
    return (
      <>
        <SettleHeader title={title} />
        <EmptyState
          icon={icons.error}
          title={t('balances.settle.load_error')}
          description={groupQuery.error?.message}
          actionLabel={t('common.retry')}
          onAction={() => void groupQuery.refetch()}
        />
      </>
    );
  }

  if (!balanceToSettle || !friend) {
    if (!balances.length) {
      return (
        <>
          <SettleHeader title={t('balances.settle.group_title')} />
          {selectionChanged ? (
            <Notice>{t('balances.settle.balances_changed_member')}</Notice>
          ) : null}
          <EmptyState icon={icons.success} title={t('balances.settle.group_settled')} />
        </>
      );
    }

    return (
      <>
        <SettleHeader title={t('balances.settle.group_title')} />
        {selectionChanged ? <Notice>{t('balances.settle.balances_changed_member')}</Notice> : null}
        <Section footer={t('balances.settle.member_footer')} separatorInset={rowInset(32)}>
          {balances.map((b) => {
            const member = membersById.get(b.firendId);

            return member ? (
              <FriendBalanceRow
                key={`${b.firendId}-${b.currency}`}
                friend={member}
                amount={b.amount}
                currency={b.currency}
                avatarSize={32}
                onPress={() => selectBalance(b)}
                accessory="chevron"
              />
            ) : (
              <ListRow
                key={`${b.firendId}-${b.currency}`}
                left={<Icon name={icons.personMissing} size={32} color={colors.secondaryLabel} />}
                title={t('balances.settle.left_member')}
                subtitle={t('balances.settle.left_member_hint')}
                disabled
              />
            );
          })}
        </Section>
      </>
    );
  }

  return (
    <>
      <SettleHeader
        title={t('balances.friend.settle_up')}
        onBack={1 < balances.length ? () => selectBalance(undefined) : undefined}
        save={{
          onPress: save,
          disabled: !canSave,
          loading: addGroupExpenseMutation.isLoading,
        }}
      />
      <SettleUpPayment
        currentUser={currentUser}
        friend={friend}
        isCurrentUserPaying={isCurrentUserPaying}
        currency={balanceToSettle.currency}
        amount={amount}
        onAmountChange={setAmount}
        amountError={'' !== amount && null === value ? t('balances.settle.amount_invalid') : null}
        date={date}
        onDateChange={setDate}
      />
    </>
  );
};
