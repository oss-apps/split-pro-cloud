import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { parseDateInput } from '~/utils/dates';
import {
  type SettleUpDestination,
  type SettleUpSelection,
  buildSettleUpPayment,
  getDefaultSelection,
  getSettleUpDestinations,
  getSettleableCurrencies,
  resolveSelection,
} from '~/utils/settleUp';

import { useCurrentUser } from '@/components/expense';
import { FriendBalanceRow } from '@/components/friend/FriendBalanceRow';
import {
  EmptyState,
  FullScreenSpinner,
  ListRow,
  Section,
  Text,
  icons,
  rowInset,
} from '@/components/ui';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { formatMoney } from '@/lib/money';
import { spacing } from '@/theme/tokens';

import { SettleUpPayment } from './SettleUpPayment';
import { Notice, SettleHeader, readAmount, toAmountInput, useSettleUpCallbacks } from './shared';

/** Port of the web's src/components/Friend/Settleup.tsx: settle with one friend. */
export const FriendSettleUp: React.FC<{ friendId: number }> = ({ friendId }) => {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const friendQuery = api.user.getFriend.useQuery({ friendId });
  const breakdownQuery = api.user.getBalanceBreakdownWithFriend.useQuery({ friendId });
  const addExpenseMutation = api.user.addOrEditExpense.useMutation();
  const addGroupExpenseMutation = api.group.addOrEditExpense.useMutation();
  const callbacks = useSettleUpCallbacks({
    pathname: '/balances/[friendId]',
    params: { friendId: String(friendId) },
  });

  const currencies = getSettleableCurrencies(breakdownQuery.data ?? []);

  // Keep only ids, so what is shown and paid always comes from the latest balances.
  const [currency, setCurrency] = useState<string | undefined>();
  const [selection, setSelection] = useState<SettleUpSelection | undefined>();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [initialized, setInitialized] = useState(false);

  const breakdown = currencies.find((b) => b.currency === currency);
  const destinations = breakdown ? getSettleUpDestinations(breakdown) : [];
  const resolved = resolveSelection(destinations, selection);
  const selectedDestination = 'ok' === resolved.status ? resolved.destination : undefined;
  // Balances can change while the sheet is open. Never pay a different destination than the one
  // that was picked: drop the choice and ask again.
  const selectionChanged = 'stale' === resolved.status;
  // With only "All balances" there is nothing to choose, unless that choice was dropped.
  const showDestinations = destinations.some((d) => 'all' !== d.id) || !selectedDestination;
  const value = readAmount(amount);
  const isSaving = addExpenseMutation.isLoading || addGroupExpenseMutation.isLoading;
  const canSave = !!breakdown && !!selectedDestination && null !== value && !isSaving;

  const selectDestination = (destination: SettleUpDestination | SettleUpSelection | undefined) => {
    setSelection(destination ? { id: destination.id, amount: destination.amount } : undefined);
    setAmount(destination ? toAmountInput(destination.amount) : '');
  };

  const selectCurrency = (currencyBreakdown: (typeof currencies)[number]) => {
    setCurrency(currencyBreakdown.currency);
    selectDestination(getDefaultSelection(getSettleUpDestinations(currencyBreakdown)));
  };

  const clearCurrency = () => {
    setCurrency(undefined);
    selectDestination(undefined);
  };

  // With a single currency there is nothing to choose, so open straight on the payment.
  if (!initialized && breakdownQuery.data) {
    setInitialized(true);
    const [onlyCurrency] = currencies;
    if (1 === currencies.length && onlyCurrency) {
      selectCurrency(onlyCurrency);
    }
  }

  const describeAmount = (cents: number, code: string) => {
    if (0 === cents) {
      return t('balances.settle.settled');
    }

    const formatted = formatMoney(cents, code);
    return 0 < cents
      ? t('balances.settle.you_get_amount', { amount: formatted })
      : t('balances.settle.you_owe_amount', { amount: formatted });
  };

  const save = () => {
    if (!canSave || !breakdown || !selectedDestination || null === value || !currentUser) {
      return;
    }

    // All balances is a personal payment. Paying the whole total also clears every group, which
    // the server records so the payment can be undone.
    const settlement = buildSettleUpPayment({
      destination: selectedDestination,
      currency: breakdown.currency,
      value,
      currentUserId: currentUser.id,
      friendId,
      expenseDate: parseDateInput(date),
    });

    if ('group' === settlement.kind) {
      addGroupExpenseMutation.mutate(settlement.payment, callbacks);
    } else {
      addExpenseMutation.mutate(settlement.payment, callbacks);
    }
  };

  const title = t('screens.settle_up');

  if (breakdownQuery.isLoading || friendQuery.isLoading || !currentUser) {
    return (
      <>
        <SettleHeader title={title} />
        <FullScreenSpinner grouped />
      </>
    );
  }

  const friend = friendQuery.data;

  if (breakdownQuery.isError || friendQuery.isError || !friend) {
    return (
      <>
        <SettleHeader title={title} />
        <EmptyState
          icon={icons.error}
          title={t('balances.settle.load_error')}
          description={(breakdownQuery.error ?? friendQuery.error)?.message}
          actionLabel={t('common.retry')}
          onAction={() => {
            void breakdownQuery.refetch();
            void friendQuery.refetch();
          }}
        />
      </>
    );
  }

  const friendName = friend.name ?? friend.email ?? '';

  if (!currencies.length) {
    return (
      <>
        <SettleHeader title={title} />
        <EmptyState
          icon={icons.settle}
          title={t('balances.settle.nothing_to_settle')}
          description={t('balances.settle.nothing_to_settle_description', { name: friendName })}
        />
      </>
    );
  }

  if (!breakdown) {
    return (
      <>
        <SettleHeader title={t('balances.settle.select_currency')} />
        {selectionChanged ? (
          <Notice>{t('balances.settle.balances_changed_currency')}</Notice>
        ) : null}
        <Section footer={t('balances.settle.currency_footer')} separatorInset={rowInset(32)}>
          {currencies.map((b) =>
            0 === b.total ? (
              <ListRow
                key={b.currency}
                title={b.currency.toUpperCase()}
                right={
                  <Text variant="subheadline" color="secondaryLabel">
                    {t('balances.settle.settled_in_groups')}
                  </Text>
                }
                onPress={() => selectCurrency(b)}
                accessory="chevron"
              />
            ) : (
              <FriendBalanceRow
                key={b.currency}
                friend={friend}
                amount={b.total}
                currency={b.currency}
                avatarSize={32}
                onPress={() => selectCurrency(b)}
                accessory="chevron"
              />
            ),
          )}
        </Section>
      </>
    );
  }

  const destinationSection = showDestinations ? (
    <>
      {selectionChanged ? (
        <Notice>{t('balances.settle.balances_changed_destination')}</Notice>
      ) : null}
      <Section
        header={t('balances.settle.destination_title')}
        footer={
          0 !== breakdown.nonGroup
            ? t('balances.settle.outside_groups', {
                amount: describeAmount(breakdown.nonGroup, breakdown.currency),
              })
            : undefined
        }
      >
        {destinations.map((d) => {
          const group =
            'all' === d.id ? undefined : breakdown.groups.find((g) => g.groupId === d.id);
          const label =
            'all' === d.id
              ? t('balances.settle.all_balances')
              : (group?.name ?? t('balances.settle.group_you_left'));
          const hint =
            'all' === d.id
              ? d.hint && t('balances.settle.all_balances_hint')
              : d.disabled
                ? t('balances.settle.left_group_hint')
                : undefined;
          const isSelected = selectedDestination?.id === d.id;

          return (
            <ListRow
              key={String(d.id)}
              title={label}
              subtitle={hint || undefined}
              right={
                <Text
                  variant="subheadline"
                  color={0 < d.amount ? 'positive' : 'negative'}
                  tabular
                  numberOfLines={1}
                >
                  {describeAmount(d.amount, breakdown.currency)}
                </Text>
              }
              accessory={isSelected ? 'checkmark' : undefined}
              disabled={d.disabled}
              onPress={() => {
                if (!isSelected) {
                  haptics.selection();
                }
                selectDestination(d);
              }}
            />
          );
        })}
      </Section>
    </>
  ) : null;

  return (
    <>
      <SettleHeader
        title={t('balances.friend.settle_up')}
        onBack={1 < currencies.length ? clearCurrency : undefined}
        save={{ onPress: save, disabled: !canSave, loading: isSaving }}
      />
      {selectedDestination ? (
        <SettleUpPayment
          currentUser={currentUser}
          friend={friend}
          isCurrentUserPaying={0 > selectedDestination.amount}
          currency={breakdown.currency}
          amount={amount}
          onAmountChange={setAmount}
          amountError={'' !== amount && null === value ? t('balances.settle.amount_invalid') : null}
          date={date}
          onDateChange={setDate}
        >
          {destinationSection}
        </SettleUpPayment>
      ) : (
        <View style={styles.destinationsOnly}>{destinationSection}</View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  destinationsOnly: {
    paddingTop: spacing[4],
  },
});
