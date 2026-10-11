import React from 'react';
import { ArrowRightIcon, CalendarIcon } from 'lucide-react';
import { UserAvatar } from '../ui/avatar';
import { Input } from '../ui/input';
import { toDateInputValue } from '~/utils/dates';

type PaymentUser = { name?: string | null; email?: string | null; image?: string | null };

/**
 * Who pays whom, an editable amount and the day it was paid (empty for today). Shared by the
 * friend and group settle up drawers.
 */
export const SettleUpPayment: React.FC<{
  currentUser: PaymentUser;
  friend: PaymentUser;
  isCurrentUserPaying: boolean;
  currency: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  date: string;
  onDateChange: (date: string) => void;
}> = ({
  currentUser,
  friend,
  isCurrentUserPaying,
  currency,
  amount,
  onAmountChange,
  date,
  onDateChange,
}) => {
  const today = toDateInputValue(new Date());

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-5">
          <UserAvatar user={isCurrentUserPaying ? currentUser : friend} />
          <ArrowRightIcon className="h-6 w-6 text-gray-600" />
          <UserAvatar user={isCurrentUserPaying ? friend : currentUser} />
        </div>
        <p className="mt-2 text-center text-sm text-gray-400">
          {isCurrentUserPaying
            ? `You're paying ${friend.name ?? friend.email}`
            : `${friend.name ?? friend.email} is paying you`}
        </p>
      </div>
      <div className="mt-3 flex  items-center gap-2">
        <p className="text-lg">{currency}</p>
        <Input
          type="number"
          value={amount}
          inputMode="decimal"
          className="mx-auto  w-[150px] text-lg"
          onChange={(e) => onAmountChange(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-400">
        <CalendarIcon className="h-5 w-5 text-cyan-500" />
        <span className="sr-only">Payment date</span>
        <input
          type="date"
          value={date || today}
          max={today}
          onChange={(e) => onDateChange(e.target.value)}
          className="bg-transparent text-foreground outline-none dark:[color-scheme:dark]"
        />
      </label>
    </div>
  );
};
