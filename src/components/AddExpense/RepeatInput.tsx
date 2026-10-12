import { Check, Repeat } from 'lucide-react';
import React from 'react';

import { useAddExpenseStore } from '~/store/addStore';
import {
  RECURRING_FREQUENCIES,
  SHORT_FREQUENCY_LABELS,
  describeSchedule,
  formatScheduleDate,
  getLocalDate,
  getNextOccurrence,
} from '~/utils/recurrence';
import { Button } from '../ui/button';
import { AppDrawer, DrawerClose } from '../ui/drawer';

/** The device's time zone, which a new rule's dates start in. */
export const getDeviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const RepeatInput: React.FC = () => {
  const recurrence = useAddExpenseStore((s) => s.recurrence);
  const loadedRecurrence = useAddExpenseStore((s) => s.loadedRecurrence);
  const expenseDate = useAddExpenseStore((s) => s.expenseDate);
  const { setRecurrence } = useAddExpenseStore((s) => s.actions);

  const timeZone = getDeviceTimeZone();
  const today = getLocalDate(new Date(), timeZone);
  const start = expenseDate ? getLocalDate(expenseDate, timeZone) : today;

  return (
    <AppDrawer
      trigger={
        <Button variant="ghost" className="justify-start px-0 font-normal">
          <Repeat className="mr-2 h-5 w-5 text-cyan-500" />
          {recurrence ? SHORT_FREQUENCY_LABELS[recurrence] : 'Repeat'}
        </Button>
      }
      title="Repeat"
      className="h-[70vh]"
    >
      <div className="flex flex-col">
        {[null, ...RECURRING_FREQUENCIES].map((option) => (
          <DrawerClose
            key={option ?? 'none'}
            className="flex items-center justify-between rounded-md px-2 py-3 text-left"
            onClick={() => setRecurrence(option)}
          >
            <div>
              <p>{option ? describeSchedule(option, start) : "Don't repeat"}</p>
              {/* An expense that already repeats keeps its series' dates, so there's no preview. */}
              {option && !loadedRecurrence ? (
                <p className="text-xs text-gray-500">
                  Next on {formatScheduleDate(getNextOccurrence(option, start, start, today))}
                </p>
              ) : null}
            </div>
            {option === recurrence ? <Check className="h-5 w-5 text-cyan-500" /> : null}
          </DrawerClose>
        ))}
      </div>
    </AppDrawer>
  );
};
