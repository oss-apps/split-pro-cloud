import React from 'react';
import clsx from 'clsx';
import { Button } from '../ui/button';
import { AppDrawer, DrawerClose } from '../ui/drawer';
import { type User, type Balance, SplitType } from '@prisma/client';
import { type User as NextUser } from 'next-auth';
import { FriendBalance } from './FirendBalance';
import { SettleUpPayment } from './SettleUpPayment';
import { api } from '~/utils/api';
import { toast } from 'sonner';
import { toFixedNumber, toUIString } from '~/utils/numbers';

/** Where a payment goes: everything with this friend, only outside groups, or one group. */
type Destination = 'everything' | 'nonGroup' | number;

export const SettleUp: React.FC<{
  balances: Array<Balance>;
  friend: User;
  currentUser: NextUser;
}> = ({ balances, friend, currentUser }) => {
  // Keep only the currency so the balance shown is always the latest one, not a stale copy.
  const [currency, setCurrency] = React.useState<string | undefined>(
    balances.length > 1 ? undefined : balances[0]?.currency,
  );
  const [amount, setAmount] = React.useState<string>(
    balances.length > 1 ? '' : toFixedNumber(Math.abs(balances[0]?.amount ?? 0)).toString(),
  );
  const [destination, setDestination] = React.useState<Destination>('everything');
  const balanceToSettle = balances.find((b) => b.currency === currency);
  const setBallanceToSettle = (balance: Balance | undefined) => setCurrency(balance?.currency);

  const breakdownQuery = api.user.getBalanceBreakdownWithFriend.useQuery({ friendId: friend.id });
  const breakdown = breakdownQuery.data?.find((b) => b.currency === balanceToSettle?.currency);
  const groups = breakdown?.groups ?? [];

  const destinations = [
    {
      id: 'everything' as Destination,
      label: 'Everything',
      hint: 'Paying it all settles every group too',
      amount: balanceToSettle?.amount ?? 0,
      disabled: false,
    },
    {
      id: 'nonGroup' as Destination,
      label: 'Non-group',
      hint: 'Expenses outside groups',
      amount: breakdown?.nonGroup ?? 0,
      disabled: 0 === (breakdown?.nonGroup ?? 0),
    },
    ...groups.map((group) => ({
      id: group.groupId as Destination,
      label: group.name ?? 'A group you left',
      hint: group.canSettle ? undefined : 'Not in this group anymore',
      amount: group.amount,
      disabled: !group.canSettle,
    })),
  ];
  const selectedDestination =
    destinations.find((d) => d.id === destination && !d.disabled) ?? destinations[0]!;

  const isCurrentUserPaying = selectedDestination.amount < 0;

  function onSelectBalance(balance: Balance) {
    setBallanceToSettle(balance);
    setDestination('everything');
    setAmount(toFixedNumber(Math.abs(balance.amount)).toString());
  }

  // The drawer stays mounted, so start every visit from the latest balances.
  function onOpen() {
    const [onlyBalance] = balances;
    if (1 === balances.length && onlyBalance) {
      onSelectBalance(onlyBalance);
    } else {
      setBallanceToSettle(undefined);
    }
  }

  function onSelectDestination(d: (typeof destinations)[number]) {
    setDestination(d.id);
    setAmount(toFixedNumber(Math.abs(d.amount)).toString());
  }

  const addExpenseMutation = api.user.addOrEditExpense.useMutation();
  const addGroupExpenseMutation = api.group.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  function saveExpense() {
    if (!balanceToSettle || !amount || !parseFloat(amount)) {
      return;
    }

    const value = parseFloat(amount);
    const payment = {
      name: 'Settle up',
      currency: balanceToSettle.currency,
      amount: value,
      splitType: SplitType.SETTLEMENT,
      participants: [
        { userId: currentUser.id, amount: isCurrentUserPaying ? value : -value },
        { userId: friend.id, amount: isCurrentUserPaying ? -value : value },
      ],
      paidBy: isCurrentUserPaying ? currentUser.id : friend.id,
      category: 'general',
    };
    const callbacks = {
      onSuccess: () => {
        utils.user.invalidate().catch(console.error);
        utils.group.invalidate().catch(console.error);
      },
      onError: (error: { message: string }) => {
        toast.error(error.message || 'Error while saving expense');
      },
    };

    // Everything and non-group are both personal payments. Paying the whole total also clears
    // every group, which the server records so the payment can be undone.
    if ('number' === typeof selectedDestination.id) {
      addGroupExpenseMutation.mutate({ ...payment, groupId: selectedDestination.id }, callbacks);
    } else {
      addExpenseMutation.mutate(payment, callbacks);
    }
  }

  return (
    <>
      <AppDrawer
        trigger={
          <Button
            size="sm"
            className="flex w-[150px] items-center gap-2 rounded-md border bg-cyan-500 px-3  text-sm font-normal text-black focus:bg-cyan-600 focus:ring-0 focus-visible:outline-none lg:w-[180px] "
            disabled={!balances.length}
          >
            Settle up
          </Button>
        }
        disableTrigger={!balances?.length}
        onTriggerClick={onOpen}
        leftAction={''}
        leftActionOnClick={() => {
          setBallanceToSettle(undefined);
        }}
        title=""
        className="h-[70vh]"
        actionTitle=""
        shouldCloseOnAction
      >
        <div>
          <div className="flex items-center justify-between px-2">
            <div>
              {balanceToSettle ? (
                balances.length > 1 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className=" text-cyan-500 lg:hidden"
                    onClick={() => setBallanceToSettle(undefined)}
                  >
                    Back
                  </Button>
                ) : (
                  <DrawerClose>
                    <Button
                      size="sm"
                      variant="ghost"
                      className=" text-cyan-500 lg:hidden"
                      onClick={() => (balances.length > 1 ? setBallanceToSettle(undefined) : null)}
                    >
                      Back
                    </Button>
                  </DrawerClose>
                )
              ) : (
                <div></div>
              )}
            </div>
            <div className="mb-2 mt-4 text-center">
              {balanceToSettle ? 'Settle up' : 'Select currency'}
            </div>
            {balanceToSettle ? (
              <DrawerClose>
                <Button
                  size="sm"
                  variant="ghost"
                  className=" mx-auto text-cyan-500 lg:hidden"
                  onClick={() => saveExpense()}
                >
                  Save
                </Button>
              </DrawerClose>
            ) : (
              <div></div>
            )}
          </div>
          {!balanceToSettle ? (
            <div>
              {balances?.map((b) => (
                <div
                  key={`${b.friendId}-${b.currency}`}
                  onClick={() => onSelectBalance(b)}
                  className="cursor-pointer px-4 py-2"
                >
                  <FriendBalance user={friend} balance={b} />
                </div>
              ))}
            </div>
          ) : (
            <div
              className={clsx('flex flex-col items-center gap-6', groups.length ? 'mt-6' : 'mt-10')}
            >
              {groups.length ? (
                <div className="w-full px-2">
                  <p className="mb-2 text-sm text-gray-400">Where does this payment go?</p>
                  <div className="flex flex-col gap-2">
                    {destinations.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={d.disabled}
                        onClick={() => onSelectDestination(d)}
                        className={clsx(
                          'flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left',
                          selectedDestination.id === d.id ? 'border-cyan-500' : 'border-gray-800',
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
                            0 === d.amount
                              ? 'text-gray-500'
                              : 0 < d.amount
                                ? 'text-green-500'
                                : 'text-orange-600',
                          )}
                        >
                          {0 === d.amount
                            ? 'settled'
                            : `${0 < d.amount ? 'you get' : 'you owe'} ${balanceToSettle.currency} ${toUIString(d.amount)}`}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <SettleUpPayment
                currentUser={currentUser}
                friend={friend}
                isCurrentUserPaying={isCurrentUserPaying}
                currency={balanceToSettle.currency}
                amount={amount}
                onAmountChange={setAmount}
              />
            </div>
          )}
          <div className="mt-8 hidden items-center justify-center gap-4 px-2 lg:flex">
            <div>
              {balanceToSettle ? (
                balances.length > 1 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setBallanceToSettle(undefined)}
                  >
                    Back
                  </Button>
                ) : (
                  <DrawerClose>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => (balances.length > 1 ? setBallanceToSettle(undefined) : null)}
                    >
                      Back
                    </Button>
                  </DrawerClose>
                )
              ) : (
                <div></div>
              )}
            </div>
            {balanceToSettle ? (
              <DrawerClose>
                <Button size="sm" className=" mx-auto " onClick={() => saveExpense()}>
                  Save
                </Button>
              </DrawerClose>
            ) : (
              <div></div>
            )}
          </div>
        </div>
      </AppDrawer>
    </>
  );
};
