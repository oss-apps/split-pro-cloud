import Head from 'next/head';
import MainLayout from '~/components/Layout/MainLayout';
import { SplitType } from '@prisma/client';
import { api } from '~/utils/api';
import { UserAvatar } from '~/components/ui/avatar';
import Link from 'next/link';
import { ChevronLeftIcon, PlusIcon, Trash, Trash2 } from 'lucide-react';
import { Fragment } from 'react';
import { Separator } from '~/components/ui/separator';
import { Button } from '~/components/ui/button';
import { SettleUp } from '~/components/Friend/Settleup';
import { toSignedUIString, toUIString } from '~/utils/numbers';
import {
  SHARE_TONE_CLASS,
  getNetShareLabel,
  getNetWithFriend,
  hasShareWithFriend,
} from '~/utils/expenseLabels';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { useRouter } from 'next/router';
import { type NextPageWithUser } from '~/types';
import { motion } from 'framer-motion';
import { DeleteFriend } from '~/components/Friend/DeleteFriend';
import { Export } from '~/components/Friend/Export';
import { DateColumn, MonthHeader } from '~/components/Expense/ExpenseListDate';
import { isNewMonth } from '~/utils/dates';

const FriendPage: NextPageWithUser = ({ user }) => {
  const router = useRouter();
  const { friendId } = router.query;

  const _friendId = parseInt(friendId as string);

  const friendQuery = api.user.getFriend.useQuery(
    { friendId: _friendId },
    { enabled: !!_friendId },
  );

  const expenses = api.user.getExpensesWithFriend.useQuery(
    { friendId: _friendId },
    { enabled: !!_friendId },
  );
  const balances = api.user.getBalancesWithFriend.useQuery(
    { friendId: _friendId },
    { enabled: !!_friendId },
  );

  // The export keeps every expense; the list skips those where neither owes the other anything.
  const listedExpenses = expenses.data?.filter((e) => hasShareWithFriend(e, user.id, _friendId));

  const youLent = balances.data?.filter((b) => b.amount > 0);
  const youOwe = balances.data?.filter((b) => b.amount < 0);

  return (
    <>
      <Head>
        <title>Outstanding balances</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <MainLayout
        title={
          <div className="flex items-center gap-2">
            <Link href="/balances">
              <ChevronLeftIcon className="mr-1 h-6 w-6" />
            </Link>
            <p className="text-lg font-normal">{friendQuery.data?.name}</p>
          </div>
        }
        actions={
          <DeleteFriend
            friendId={_friendId}
            disabled={!(youLent?.length === 0 && youOwe?.length === 0)}
          />
        }
        header={
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Link href="/balances">
                <ChevronLeftIcon className="mr-1 h-6 w-6" />
              </Link>
              <UserAvatar user={friendQuery.data} size={25} />
              {friendQuery.data?.name}
            </div>
          </div>
        }
      >
        {balances.isLoading ||
        expenses.isLoading ||
        friendQuery.isLoading ||
        !friendQuery.data ? null : (
          <motion.div className="mb-28" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mx-4 flex flex-wrap gap-2">
              <div className=" text-orange-700">
                {(youOwe?.length ?? 0) > 0 && (
                  <>
                    You owe{' '}
                    {youOwe?.map((b, index) => (
                      <span key={b.currency}>
                        <span className=" font-semibold tracking-wide">
                          {b.currency} {toUIString(b.amount)}
                        </span>
                        {youOwe.length - 1 === index ? '' : ' + '}
                      </span>
                    ))}
                  </>
                )}
              </div>
              <div>{(youOwe?.length ?? 0) > 0 && (youLent?.length ?? 0) > 0 ? '+' : null}</div>
              <div className=" text-emerald-600">
                {(youLent?.length ?? 0) > 0 && (
                  <>
                    You lent{' '}
                    {youLent?.map((b, index) => (
                      <span key={b.currency}>
                        <span className=" font-semibold tracking-wide">
                          {b.currency} {toUIString(b.amount)}
                        </span>
                        {youLent.length - 1 === index ? '' : ' + '}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <div className="mb-4 mt-6 flex justify-center gap-2 px-2 ">
              {friendQuery.data ? (
                <SettleUp key={friendQuery.data.id} friend={friendQuery.data} currentUser={user} />
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-[150px] gap-1 text-sm lg:w-[180px]"
                  disabled
                >
                  Settle up
                </Button>
              )}

              <Link href={`/add?friendId=${friendQuery.data.id}`}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-[150px] gap-1 text-sm lg:w-[180px]"
                >
                  <PlusIcon className="h-4 w-4 text-gray-400" /> Add Expense
                </Button>
              </Link>
              <Export
                expenses={expenses.data ?? []}
                fileName={`expenses_with_${friendQuery.data?.name}`}
                currentUserId={user.id}
                friendName={friendQuery.data?.name ?? ''}
                friendId={friendQuery.data?.id ?? ''}
                disabled={!expenses.data || expenses.data.length === 0}
              />
              {/* <Button size="sm" className="gap-1 text-sm lg:w-[180px]" variant="secondary">
                <Bell className="h-4 w-4 text-gray-400" />
                Remind
              </Button> */}
            </div>
            <Separator className="px-4" />
            <div className="mx-4 mt-4 flex  flex-col gap-3">
              {listedExpenses?.map((e, index, expenseList) => {
                const youPaid = e.paidBy === user.id;
                const yourShare = getNetShareLabel(getNetWithFriend(e, user.id, _friendId));
                const isSettlement = e.splitType === SplitType.SETTLEMENT;

                return (
                  <Fragment key={e.id}>
                    {isNewMonth(e.expenseDate, expenseList[index - 1]?.expenseDate) ? (
                      <MonthHeader date={e.expenseDate} />
                    ) : null}
                    <Link
                      href={`/balances/${friendQuery.data?.id}/expenses/${e.id}`}
                      className="flex items-start justify-between px-2 py-2"
                    >
                      <div className="flex items-center gap-3 px-1">
                        <DateColumn date={e.expenseDate} />
                        <div className="">
                          <CategoryIcon category={e.category} className="h-5 w-5 text-gray-400" />
                        </div>
                        <div>
                          {!isSettlement ? (
                            <p className=" max-w-[180px] truncate text-sm lg:max-w-md lg:text-base">
                              {e.name}
                            </p>
                          ) : null}
                          <p
                            className={`flex ${isSettlement ? 'text-sm text-gray-400' : 'text-xs text-gray-500'}`}
                          >
                            <span className={`text-[8px] ${isSettlement ? 'mr-1' : ''} `}>
                              {isSettlement ? '  🎉 ' : null}
                            </span>
                            <span>
                              {youPaid ? 'You' : friendQuery.data?.name} paid {e.currency}{' '}
                              {toSignedUIString(e.amount)}
                              {isSettlement && e.group ? ` in ${e.group.name}` : ''}{' '}
                            </span>
                          </p>
                        </div>
                      </div>
                      {isSettlement ? null : (
                        <div className="min-w-10 shrink-0">
                          <div className={`text-right text-xs ${SHARE_TONE_CLASS[yourShare.tone]}`}>
                            {yourShare.label}
                          </div>
                          <div className={`text-right ${SHARE_TONE_CLASS[yourShare.tone]}`}>
                            <span className="font-light ">{e.currency}</span>{' '}
                            {toUIString(yourShare.amount)}
                          </div>
                        </div>
                      )}
                    </Link>
                  </Fragment>
                );
              })}
            </div>
          </motion.div>
        )}
      </MainLayout>
    </>
  );
};

FriendPage.auth = true;

export default FriendPage;
