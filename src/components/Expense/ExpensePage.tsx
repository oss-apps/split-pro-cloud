import { type ExpenseParticipant, type Expense, type User, SplitType } from '@prisma/client';
import { type User as NextUser } from 'next-auth';
import { format, isSameDay } from 'date-fns';
import React from 'react';
import { toSignedUIString, toUIString } from '~/utils/numbers';
import { getParticipantShareLabel } from '~/utils/expenseLabels';
import { UserAvatar } from '../ui/avatar';
import Image from 'next/image';
import { AppDrawer, Drawer, DrawerContent, DrawerTrigger } from '../ui/drawer';
import { Separator } from '../ui/separator';
import { CategoryIcons } from '../ui/categoryIcons';
import { Banknote } from 'lucide-react';
import { env } from '~/env';
import { ExpenseRecurringRule } from './RecurringRule';

type ExpenseDetailsProps = {
  user: NextUser;
  expense: Expense & {
    expenseParticipants: Array<ExpenseParticipant & { user: User }>;
    addedByUser: User;
    paidByUser: User;
    deletedByUser: User | null;
    updatedByUser: User | null;
  };
  storagePublicUrl?: string;
};

const ExpenseDetails: React.FC<ExpenseDetailsProps> = ({ user, expense, storagePublicUrl }) => {
  const youPaid = expense.paidBy === user.id;
  const isSettlement = SplitType.SETTLEMENT === expense.splitType;

  const CategoryIcon = CategoryIcons[expense.category] ?? Banknote;

  return (
    <div className="">
      <div className="mb-4 flex items-start justify-between gap-2 px-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg border p-2 text-xl">
            <CategoryIcon className="text-gray-400" size={24} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="">{expense.name}</p>
            <p className="text-2xl font-semibold">
              {expense.currency} {toSignedUIString(expense.amount ?? 0)}
            </p>
            {!isSameDay(expense.expenseDate, expense.createdAt) ? (
              <p className="text-sm text-gray-500">{format(expense.expenseDate, 'dd MMM yyyy')}</p>
            ) : null}
            {expense.updatedByUser ? (
              <p className=" text-sm text-gray-500">
                Edited by {expense.updatedByUser?.name ?? expense.updatedByUser?.email} on{' '}
                {format(expense.updatedAt, 'dd MMM yyyy')}
              </p>
            ) : null}
            {expense.deletedByUser ? (
              <p className=" text-sm text-orange-600">
                Deleted by {expense.deletedByUser.name ?? expense.addedByUser.email} on{' '}
                {format(expense.deletedAt ?? expense.createdAt, 'dd MMM yyyy')}
              </p>
            ) : (
              <p className=" text-sm text-gray-500">
                Added by {expense.addedByUser.name ?? expense.addedByUser.email} on{' '}
                {format(expense.createdAt, 'dd MMM yyyy')}
              </p>
            )}
            {expense.recurringId ? <ExpenseRecurringRule ruleId={expense.recurringId} /> : null}
          </div>
        </div>
        <div>
          {expense.fileKey ? (
            <AppDrawer
              trigger={
                <Image
                  src={`${storagePublicUrl}/${expense.fileKey}`}
                  alt="Expense receipt"
                  width={56}
                  height={56}
                  data-loaded="false"
                  onLoad={(event) => {
                    event.currentTarget.setAttribute('data-loaded', 'true');
                  }}
                  className=" h-14 w-14 rounded-md object-cover object-center data-[loaded=false]:animate-pulse data-[loaded=false]:bg-gray-100/10"
                />
              }
              leftAction="Close"
              title="Expense Receipt"
              className="h-[98vh]"
            >
              <div className="mb-8 overflow-scroll">
                <Image
                  src={`${storagePublicUrl}/${expense.fileKey}`}
                  width={300}
                  height={800}
                  alt="Expense receipt"
                  data-loaded="false"
                  onLoad={(event) => {
                    event.currentTarget.setAttribute('data-loaded', 'true');
                  }}
                  className="h-full w-full rounded-2xl object-cover data-[loaded=false]:animate-pulse data-[loaded=false]:bg-gray-100/10"
                />
              </div>
            </AppDrawer>
          ) : null}
        </div>
      </div>
      <Separator />
      <div className="mt-10 flex items-center gap-5 px-6">
        <UserAvatar user={expense.paidByUser} size={35} />
        <p>
          {youPaid ? 'You' : expense.paidByUser.name ?? expense.paidByUser.email} paid{' '}
          {expense.currency} {toSignedUIString(expense.amount)}
        </p>
      </div>
      <div className="ml-14 mt-4 flex flex-col gap-4 px-6">
        {expense.expenseParticipants.map((p) =>
          isSettlement ? (
            p.userId === expense.paidBy ? null : (
              <div key={p.userId} className="flex items-center gap-2 text-sm text-gray-500">
                <UserAvatar user={p.user} size={25} />
                <p>
                  {user.id === p.userId ? 'You' : p.user.name ?? p.user.email} received{' '}
                  {expense.currency} {toUIString(expense.amount)}
                </p>
              </div>
            )
          ) : (
            <ParticipantShare
              key={p.userId}
              participant={p}
              share={(expense.paidBy === p.userId ? expense.amount ?? 0 : 0) - p.amount}
              isYou={user.id === p.userId}
              currency={expense.currency}
            />
          ),
        )}
      </div>
    </div>
  );
};

const ParticipantShare: React.FC<{
  participant: ExpenseParticipant & { user: User };
  share: number;
  isYou: boolean;
  currency: string;
}> = ({ participant, share, isYou, currency }) => {
  const { label, amount } = getParticipantShareLabel(
    share,
    isYou,
    participant.user.name ?? participant.user.email ?? '',
  );

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500">
      <UserAvatar user={participant.user} size={25} />
      <p>
        {label} {currency} {toUIString(amount)}
      </p>
    </div>
  );
};

export default ExpenseDetails;
