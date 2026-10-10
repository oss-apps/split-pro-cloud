import React from 'react';
import { type GroupBalance, type User, SplitType } from '@prisma/client';
import { type User as NextUser } from 'next-auth';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { AppDrawer, DrawerClose } from '../ui/drawer';
import { FriendBalance } from '../Friend/FirendBalance';
import { SettleUpPayment } from '../Friend/SettleUpPayment';
import { api } from '~/utils/api';
import { toFixedNumber } from '~/utils/numbers';

/**
 * Records a payment between the current user and one member, inside this group only.
 */
export const GroupSettleUp: React.FC<{
  groupId: number;
  currentUser: NextUser;
  groupBalances: GroupBalance[];
  members: User[];
}> = ({ groupId, currentUser, groupBalances, members }) => {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const balances = groupBalances
    .filter((b) => b.userId === currentUser.id && 0 !== b.amount)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const [firstBalance] = balances;

  const [balanceToSettle, setBalanceToSettle] = React.useState<GroupBalance | undefined>();
  const [amount, setAmount] = React.useState('');

  const friend = balanceToSettle ? membersById.get(balanceToSettle.firendId) : undefined;
  const isCurrentUserPaying = (balanceToSettle?.amount ?? 0) < 0;

  function onSelectBalance(balance: GroupBalance) {
    setBalanceToSettle(balance);
    setAmount(toFixedNumber(Math.abs(balance.amount)).toString());
  }

  // With a single balance there is nothing to choose, so open straight on the payment.
  function onOpen() {
    if (1 === balances.length && firstBalance && membersById.has(firstBalance.firendId)) {
      onSelectBalance(firstBalance);
    } else {
      setBalanceToSettle(undefined);
    }
  }

  const addGroupExpenseMutation = api.group.addOrEditExpense.useMutation();
  const utils = api.useUtils();

  function saveExpense() {
    if (!balanceToSettle || !friend || !amount || !parseFloat(amount)) {
      return;
    }

    const value = parseFloat(amount);
    addGroupExpenseMutation.mutate(
      {
        groupId,
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
      },
      {
        onSuccess: () => {
          utils.group.invalidate().catch(console.error);
          utils.user.invalidate().catch(console.error);
        },
        onError: (error) => {
          toast.error(error.message || 'Error while saving expense');
        },
      },
    );
  }

  const backButton = (className: string, variant: 'ghost' | 'secondary') =>
    1 < balances.length ? (
      <Button
        size="sm"
        variant={variant}
        className={className}
        onClick={() => setBalanceToSettle(undefined)}
      >
        Back
      </Button>
    ) : (
      <DrawerClose>
        <Button size="sm" variant={variant} className={className}>
          Back
        </Button>
      </DrawerClose>
    );

  return (
    <AppDrawer
      trigger={
        <Button size="sm" className="gap-1 text-sm lg:w-[180px]" variant="secondary">
          Settle up
        </Button>
      }
      onTriggerClick={onOpen}
      leftAction=""
      title=""
      className="h-[70vh]"
      actionTitle=""
      shouldCloseOnAction
    >
      <div>
        <div className="flex items-center justify-between px-2">
          <div>
            {balanceToSettle && friend ? backButton('text-cyan-500 lg:hidden', 'ghost') : null}
          </div>
          <div className="mb-2 mt-4 text-center">
            {balanceToSettle ? 'Settle up' : 'Settle up in this group'}
          </div>
          {balanceToSettle && friend ? (
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
        {!balanceToSettle || !friend ? (
          balances.length ? (
            <div>
              {balances.map((b) => {
                const member = membersById.get(b.firendId);

                return member ? (
                  <div
                    key={`${b.firendId}-${b.currency}`}
                    onClick={() => onSelectBalance(b)}
                    className="cursor-pointer px-4 py-2"
                  >
                    <FriendBalance user={member} balance={b} />
                  </div>
                ) : (
                  <div key={`${b.firendId}-${b.currency}`} className="px-4 py-2 opacity-50">
                    <p className="text-sm">Someone who left the group</p>
                    <p className="text-xs text-gray-500">
                      Settle up with them from their friend page
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-10 text-center text-gray-400">
              You&apos;re all settled up in this group
            </p>
          )
        ) : (
          <div className="mt-10">
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
          <div>{balanceToSettle && friend ? backButton('', 'secondary') : null}</div>
          {balanceToSettle && friend ? (
            <DrawerClose>
              <Button size="sm" className=" mx-auto " onClick={() => saveExpense()}>
                Save
              </Button>
            </DrawerClose>
          ) : null}
        </div>
      </div>
    </AppDrawer>
  );
};
