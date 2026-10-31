import { type useAddExpenseStore } from '@/store/addExpenseStore';

type FormState = ReturnType<typeof useAddExpenseStore.getState>;

/**
 * Everything the user can change in the add/edit form, as a string to compare: the form has
 * unsaved changes when it differs from the snapshot taken once the form was filled in.
 */
export const getFormSnapshot = (state: FormState) =>
  JSON.stringify([
    state.amountStr,
    state.description,
    state.category,
    state.currency,
    state.splitType,
    state.group?.id ?? null,
    state.paidBy?.id ?? null,
    state.participants.map((participant) => [
      participant.id,
      participant.amount ?? null,
      participant.splitShare ?? null,
    ]),
    state.fileKey ?? null,
    state.expenseDate?.getTime() ?? null,
    state.recurrence,
  ]);
