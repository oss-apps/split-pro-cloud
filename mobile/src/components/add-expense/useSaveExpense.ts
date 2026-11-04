import { useTranslation } from 'react-i18next';

import { isAmountWithinLimit } from '~/utils/numbers';

import { toast } from '@/components/ui';
import { api } from '@/lib/api';
import { goBackOr } from '@/lib/navigation';
import {
  getParticipantsToSave,
  getRecurrenceToSave,
  hasUnresolvedInvite,
  useAddExpenseStore,
} from '@/store/addExpenseStore';
import { useRecentCurrencies } from '@/store/recentCurrencies';

import { offerPushAfterExpense } from './offerPush';
import { getDeviceTimeZone } from './timeZone';

/**
 * Saves the form with `group.addOrEditExpense` or `user.addOrEditExpense`, like the web's
 * `addExpense`, then refreshes what shows expenses and balances and closes the form, calling
 * `beforeClose` first.
 */
export const useSaveExpense = (expenseId: string | undefined, beforeClose?: () => void) => {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const userMutation = api.user.addOrEditExpense.useMutation();
  const groupMutation = api.group.addOrEditExpense.useMutation();
  const rememberCurrency = useRecentCurrencies((s) => s.remember);

  const amount = useAddExpenseStore((s) => s.amount);
  const description = useAddExpenseStore((s) => s.description);
  const isFileUploading = useAddExpenseStore((s) => s.isFileUploading);
  const hasPendingInvite = useAddExpenseStore(hasUnresolvedInvite);

  const isSaving = userMutation.isLoading || groupMutation.isLoading;
  const isAmountTooLarge = !isAmountWithinLimit(amount);
  const isSaveDisabled =
    isSaving ||
    !amount ||
    isAmountTooLarge ||
    hasPendingInvite ||
    '' === description ||
    isFileUploading;

  const onSuccess = () => {
    Promise.all([
      utils.user.invalidate(),
      utils.group.invalidate(),
      utils.recurring.invalidate(),
    ]).catch(console.error);
    toast.success(expenseId ? t('expense.updated') : t('expense.added'));
    beforeClose?.();
    goBackOr();

    if (!expenseId) {
      offerPushAfterExpense(t).catch(console.warn);
    }
  };

  const onError = (error: { message: string }) => toast.error(error.message);

  const save = () => {
    const state = useAddExpenseStore.getState();
    const { group, paidBy, splitType, fileKey, canSplitScreenClosed, currency } = state;
    if (!paidBy || isSaveDisabled || hasUnresolvedInvite(state)) {
      return;
    }

    if (!canSplitScreenClosed) {
      state.actions.setSplitScreenOpen(true);
      return;
    }

    rememberCurrency(currency);

    const input = {
      expenseId,
      name: state.description,
      currency,
      amount: state.amount,
      splitType,
      participants: getParticipantsToSave(state).map((participant) => ({
        userId: participant.id,
        amount: participant.amount ?? 0,
      })),
      paidBy: paidBy.id,
      category: state.category,
      fileKey,
      expenseDate: state.expenseDate,
      recurrence: getRecurrenceToSave(state, getDeviceTimeZone()),
    };

    if (group) {
      groupMutation.mutate({ ...input, groupId: group.id }, { onSuccess, onError });
      return;
    }

    userMutation.mutate(input, { onSuccess, onError });
  };

  return { save, isSaving, isSaveDisabled, isAmountTooLarge };
};
