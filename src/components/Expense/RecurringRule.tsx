import { RecurringStatus } from '@prisma/client';
import { Pause, Play, Repeat, Trash2 } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { type RouterOutputs, api } from '~/utils/api';
import { toSignedUIString } from '~/utils/numbers';
import { describeSchedule, formatScheduleDate, fromDbDate } from '~/utils/recurrence';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';

type RuleView = RouterOutputs['recurring']['getRule'];

const getStatusLine = (rule: RuleView) => {
  if (RecurringStatus.ACTIVE === rule.status) {
    return `Next on ${formatScheduleDate(fromDbDate(rule.nextOccurrenceDate))}`;
  }
  const status = RecurringStatus.PAUSED === rule.status ? 'Paused' : 'Stopped';
  if (!rule.statusReason) {
    return status;
  }
  // E.g. "Paused by Sam" says it all.
  return rule.statusReason.startsWith(status)
    ? rule.statusReason
    : `${status}: ${rule.statusReason}`;
};

/** How an expense repeats, and pausing, resuming or stopping it for people in it. */
export const RecurringRule: React.FC<{ rule: RuleView; showExpense?: boolean }> = ({
  rule,
  showExpense,
}) => {
  const utils = api.useUtils();
  const setPausedMutation = api.recurring.setPaused.useMutation();
  const deleteMutation = api.recurring.delete.useMutation();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const onChanged = async () => {
    await Promise.all([
      utils.recurring.invalidate(),
      utils.group.invalidate(),
      utils.user.invalidate(),
    ]);
  };

  const setPaused = (paused: boolean) =>
    setPausedMutation.mutate(
      { ruleId: rule.id, paused },
      {
        onSuccess: () => {
          toast.success(paused ? 'Paused' : 'Resumed');
          onChanged().catch(console.error);
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const onDelete = () =>
    deleteMutation.mutate(
      { ruleId: rule.id },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          toast.success('Stopped repeating');
          onChanged().catch(console.error);
        },
        onError: (error) => toast.error(error.message),
      },
    );

  const isStopped = RecurringStatus.STOPPED === rule.status;

  return (
    <div className="flex flex-col gap-1" data-testid="recurring-rule">
      {showExpense && rule.latest ? (
        <p className="truncate">
          {rule.latest.name}{' '}
          <span className="text-sm text-gray-400">
            {rule.latest.currency} {toSignedUIString(rule.latest.amount)}
          </span>
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-sm text-gray-400">
        <Repeat className="h-4 w-4 shrink-0 text-cyan-500" />
        {describeSchedule(rule.frequency, fromDbDate(rule.startDate))}
      </p>
      <p
        className={`text-sm ${RecurringStatus.ACTIVE === rule.status ? 'text-gray-500' : 'text-orange-500'}`}
      >
        {getStatusLine(rule)}
      </p>
      {rule.canManage && !isStopped ? (
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="justify-start px-0 text-cyan-500"
            loading={setPausedMutation.isLoading}
            onClick={() => setPaused(RecurringStatus.ACTIVE === rule.status)}
          >
            {RecurringStatus.ACTIVE === rule.status ? (
              <>
                <Pause className="mr-1 h-4 w-4" /> Pause
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" /> Resume
              </>
            )}
          </Button>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="justify-start px-0 text-red-500">
                <Trash2 className="mr-1 h-4 w-4" /> Stop repeating
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-xs rounded-lg">
              <AlertDialogHeader>
                <AlertDialogTitle>Stop repeating?</AlertDialogTitle>
                <AlertDialogDescription>
                  No more expenses are added. The ones already added stay.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onDelete}
                  loading={deleteMutation.isLoading}
                >
                  Stop repeating
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
};

/** The schedule of the expense's series, on its detail page. */
export const ExpenseRecurringRule: React.FC<{ ruleId: number }> = ({ ruleId }) => {
  const ruleQuery = api.recurring.getRule.useQuery({ ruleId }, { retry: false });
  return ruleQuery.data ? <RecurringRule rule={ruleQuery.data} /> : null;
};

/** The group's recurring expenses, in its settings. */
export const GroupRecurringRules: React.FC<{ groupId: number }> = ({ groupId }) => {
  const rulesQuery = api.recurring.getGroupRules.useQuery({ groupId });
  const rules = rulesQuery.data ?? [];

  return (
    <div className="mt-8">
      <p className="font-semibold">Recurring expenses</p>
      {rules.length ? (
        <div className="mt-2 flex flex-col gap-5">
          {rules.map((rule) => (
            <RecurringRule key={rule.id} rule={rule} showExpense />
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-400">
          {rulesQuery.isLoading ? '…' : 'None. Use Repeat when adding an expense.'}
        </p>
      )}
    </div>
  );
};
