import React from 'react';
import clsx from 'clsx';
import { Button } from '../ui/button';
import { AppDrawer, DrawerClose } from '../ui/drawer';
import { type User } from '@prisma/client';
import { type User as NextUser } from 'next-auth';
import { FriendBalance } from './FirendBalance';
import { SettleUpPayment } from './SettleUpPayment';
import { api } from '~/utils/api';
import { toast } from 'sonner';
import { toFixedNumber, toUIString } from '~/utils/numbers';
import {
  type SettleUpDestination,
  type SettleUpSelection,
  buildSettleUpPayment,
  getDefaultSelection,
  getSettleUpDestinations,
  getSettleableCurrencies,
  resolveSelection,
} from '~/utils/settleUp';

const describeAmount = (amount: number, currency: string) =>
  0 === amount
    ? 'settled'
    : `${0 < amount ? 'you get' : 'you owe'} ${currency} ${toUIString(amount)}`;

export const SettleUp: React.FC<{
  friend: User;
  currentUser: NextUser;
}> = ({ friend, currentUser }) => {
  const breakdownQuery = api.user.getBalanceBreakdownWithFriend.useQuery({ friendId: friend.id });
  const currencies = getSettleableCurrencies(breakdownQuery.data ?? []);

  // Keep only ids, so what is shown and paid always comes from the latest balances.
  const [currency, setCurrency] = React.useState<string | undefined>();
  const [selection, setSelection] = React.useState<SettleUpSelection | undefined>();
  const [amount, setAmount] = React.useState('');
  const [selectionChanged, setSelectionChanged] = React.useState(false);

  const breakdown = currencies.find((b) => b.currency === currency);
  const destinations = breakdown ? getSettleUpDestinations(breakdown) : [];
  const resolved = resolveSelection(destinations, selection);
  const selectedDestination = 'ok' === resolved.status ? resolved.destination : undefined;
  // With only "All balances" there is nothing to choose, unless that choice was dropped.
  const showDestinations = destinations.some((d) => 'all' !== d.id) || !selectedDestination;
  const value = parseFloat(amount);
  const canSave = !!breakdown && !!selectedDestination && Number.isFinite(value) && 0 < value;

  // Balances can change while the drawer is open. Never pay a different destination than the one
  // that was picked: drop the choice and ask again.
  React.useEffect(() => {
    if ('stale' === resolved.status) {
      setSelection(undefined);
      setAmount('');
      setSelectionChanged(true);
    }
  }, [resolved.status]);

  function selectDestination(destination: SettleUpDestination | SettleUpSelection | undefined) {
    setSelection(destination ? { id: destination.id, amount: destination.amount } : undefined);
    setAmount(destination ? toFixedNumber(Math.abs(destination.amount)).toString() : '');
    setSelectionChanged(false);
  }

  function onSelectCurrency(currencyBreakdown: (typeof currencies)[number]) {
    setCurrency(currencyBreakdown.currency);
    selectDestination(getDefaultSelection(getSettleUpDestinations(currencyBreakdown)));
  }

  function clearCurrency() {
    setCurrency(undefined);
    selectDestination(undefined);
  }

  // The drawer stays mounted, so start every visit from the latest balances.
  function onOpen() {
    const [onlyCurrency] = currencies;
    if (1 === currencies.length && onlyCurrency) {
      onSelectCurrency(onlyCurrency);
    } else {
      clearCurrency();
    }
  }

  const addExpenseMutation = api.user.addOrEditExpense.useMutation();
  const addGroupExpenseMutation = api.group.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  function saveExpense() {
    if (!canSave || !breakdown || !selectedDestination) {
      return;
    }

    const callbacks = {
      onSuccess: () => {
        utils.user.invalidate().catch(console.error);
        utils.group.invalidate().catch(console.error);
      },
      onError: (error: { message: string }) => {
        toast.error(error.message || 'Error while saving expense');
      },
    };

    // All balances is a personal payment. Paying the whole total also clears every group, which
    // the server records so the payment can be undone.
    const settlement = buildSettleUpPayment({
      destination: selectedDestination,
      currency: breakdown.currency,
      value,
      currentUserId: currentUser.id,
      friendId: friend.id,
    });
    if ('group' === settlement.kind) {
      addGroupExpenseMutation.mutate(settlement.payment, callbacks);
    } else {
      addExpenseMutation.mutate(settlement.payment, callbacks);
    }
  }

  const backButton = (className: string, variant: 'ghost' | 'secondary') =>
    1 < currencies.length ? (
      <Button size="sm" variant={variant} className={className} onClick={clearCurrency}>
        Back
      </Button>
    ) : (
      <DrawerClose>
        <Button size="sm" variant={variant} className={className}>
          Back
        </Button>
      </DrawerClose>
    );

  const saveButton = (className: string, variant?: 'ghost') =>
    canSave ? (
      <DrawerClose>
        <Button size="sm" variant={variant} className={className} onClick={() => saveExpense()}>
          Save
        </Button>
      </DrawerClose>
    ) : (
      <Button size="sm" variant={variant} className={className} disabled>
        Save
      </Button>
    );

  return (
    <>
      <AppDrawer
        trigger={
          <Button
            size="sm"
            className="flex w-[150px] items-center gap-2 rounded-md border bg-cyan-500 px-3  text-sm font-normal text-black focus:bg-cyan-600 focus:ring-0 focus-visible:outline-none lg:w-[180px] "
            disabled={!currencies.length}
          >
            Settle up
          </Button>
        }
        disableTrigger={!currencies.length}
        onTriggerClick={onOpen}
        leftAction={''}
        leftActionOnClick={clearCurrency}
        title=""
        className="h-[70vh]"
        actionTitle=""
        shouldCloseOnAction
      >
        <div>
          <div className="flex items-center justify-between px-2">
            <div>{breakdown ? backButton(' text-cyan-500 lg:hidden', 'ghost') : <div></div>}</div>
            <div className="mb-2 mt-4 text-center">
              {breakdown ? 'Settle up' : 'Select currency'}
            </div>
            {breakdown ? saveButton(' mx-auto text-cyan-500 lg:hidden', 'ghost') : <div></div>}
          </div>
          {!breakdown ? (
            <div>
              {selectionChanged ? (
                <p className="px-4 py-2 text-sm text-orange-600">
                  Balances changed. Choose what to settle again.
                </p>
              ) : null}
              {currencies.map((b) => (
                <div
                  key={b.currency}
                  onClick={() => onSelectCurrency(b)}
                  className="cursor-pointer px-4 py-2"
                >
                  {0 === b.total ? (
                    <div className="flex items-center justify-between">
                      <p className="text-foreground">{b.currency}</p>
                      <p className="text-right text-xs text-gray-500">
                        Settled overall, open in groups
                      </p>
                    </div>
                  ) : (
                    <FriendBalance
                      user={friend}
                      balance={{ amount: b.total, currency: b.currency }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              className={clsx(
                'flex flex-col items-center gap-6',
                showDestinations ? 'mt-6' : 'mt-10',
              )}
            >
              {showDestinations ? (
                <div className="w-full px-2">
                  <p className="mb-2 text-sm text-gray-400">Where does this payment go?</p>
                  <div className="flex flex-col gap-2">
                    {destinations.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={d.disabled}
                        onClick={() => selectDestination(d)}
                        className={clsx(
                          'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left',
                          selectedDestination?.id === d.id ? 'border-cyan-500' : 'border-gray-800',
                          d.disabled && 'opacity-50',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm">{d.label}</p>
                          {d.hint ? <p className="text-xs text-gray-500">{d.hint}</p> : null}
                        </div>
                        <div
                          className={clsx(
                            'shrink-0 text-right text-sm',
                            0 < d.amount ? 'text-green-500' : 'text-orange-600',
                          )}
                        >
                          {describeAmount(d.amount, breakdown.currency)}
                        </div>
                      </button>
                    ))}
                  </div>
                  {0 !== breakdown.nonGroup ? (
                    <p className="mt-2 text-xs text-gray-500">
                      Outside groups: {describeAmount(breakdown.nonGroup, breakdown.currency)}
                    </p>
                  ) : null}
                  {selectionChanged ? (
                    <p className="mt-2 text-sm text-orange-600">
                      Balances changed. Choose where this payment goes again.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selectedDestination ? (
                <SettleUpPayment
                  currentUser={currentUser}
                  friend={friend}
                  isCurrentUserPaying={0 > selectedDestination.amount}
                  currency={breakdown.currency}
                  amount={amount}
                  onAmountChange={setAmount}
                />
              ) : null}
            </div>
          )}
          <div className="mt-8 hidden items-center justify-center gap-4 px-2 lg:flex">
            <div>{breakdown ? backButton('', 'secondary') : <div></div>}</div>
            {breakdown ? saveButton(' mx-auto ') : <div></div>}
          </div>
        </div>
      </AppDrawer>
    </>
  );
};
