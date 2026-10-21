import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import React, { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { AddExpenseForm } from '@/components/add-expense/AddExpenseForm';
import { getFormSnapshot } from '@/components/add-expense/formChanges';
import { useSaveExpense } from '@/components/add-expense/useSaveExpense';
import { EmptyState, ModalHeader, Spinner, icons } from '@/components/ui';
import { api } from '@/lib/api';
import { goBackOr, useConfirmDiscard } from '@/lib/navigation';
import { getEditFormState, isCurrentForm, useAddExpenseStore } from '@/store/addExpenseStore';
import { colors, spacing } from '@/theme/tokens';

// Refetching these would re-seed the form and wipe what the user entered, e.g. after switching apps.
const SEED_QUERY_OPTIONS = { refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

type SeedKey = 'group' | 'friend' | 'expense';

/**
 * One add or edit form: the screen that opened it, the generation it belongs to, which requested
 * seeds have loaded, and the form once they all have (to tell whether it was changed).
 */
type FormSeeds = {
  owner: string;
  formKey: string;
  generation: number;
  seeded?: string;
} & Record<SeedKey, boolean>;

/** The open form's seeds. Kept outside React state: seeding syncs it with the form store. */
const useFormSeeds = create<{ form: FormSeeds | null }>()(() => ({ form: null }));
const withSeededSnapshot = (form: FormSeeds | null) =>
  form && form.group && form.friend && form.expense && undefined === form.seeded
    ? { ...form, seeded: getFormSnapshot(useAddExpenseStore.getState()) }
    : form;
const setForm = (update: (current: FormSeeds | null) => FormSeeds | null) =>
  useFormSeeds.setState((state) => ({ form: withSeededSnapshot(update(state.form)) }));

/**
 * Add/edit expense modal. Params match the web's /add: `friendId` or `groupId` to preselect who
 * it's with, `expenseId` to edit. Seeding follows the web's src/pages/add.tsx: each requested seed
 * is applied once, to the form it was requested for.
 */
const AddExpense = () => {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    friendId?: string;
    groupId?: string;
    expenseId?: string;
  }>();
  const groupId = parseInt(params.groupId ?? '', 10) || 0;
  const friendId = parseInt(params.friendId ?? '', 10) || 0;
  const expenseId = params.expenseId || undefined;
  const formKey = [expenseId, params.groupId, params.friendId]
    .map((value) => value ?? '')
    .join('|');

  const { setCurrentUser, selectGroup, setParticipants, resetState } = useAddExpenseStore(
    (s) => s.actions,
  );
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const meQuery = api.user.me.useQuery(undefined, SEED_QUERY_OPTIONS);
  const me = meQuery.data;

  // Another add screen can mount before this one unmounts, e.g. "Add new" after an error.
  const owner = useId();
  const form = useFormSeeds((state) => state.form);
  const isCurrentKey = form?.owner === owner && form.formKey === formKey;
  const isFormReady = !!form && isCurrentKey && form.group && form.friend && form.expense;

  // Start from a clean form for every add or edit form, once we know who is adding it.
  useEffect(() => {
    if (!me) {
      return;
    }

    setCurrentUser({
      id: me.id,
      currency: me.currency,
      emailVerified: null,
      name: me.name ?? null,
      email: me.email ?? null,
      image: me.image ?? null,
    });
    resetState();
    setForm(() => ({
      owner,
      formKey,
      generation: useAddExpenseStore.getState().formGeneration,
      group: !groupId,
      friend: !friendId,
      expense: !expenseId,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, me?.id]);

  useEffect(
    () => () => {
      if (useFormSeeds.getState().form?.owner !== owner) {
        return;
      }

      resetState();
      setForm(() => null);
    },
    [owner, resetState],
  );

  const canSeed = (key: SeedKey) =>
    !!form && isCurrentKey && !form[key] && isCurrentForm(form.generation) && !!currentUser;
  const markSeeded = (key: SeedKey) =>
    setForm((current) =>
      current?.owner === owner && current.formKey === formKey
        ? { ...current, [key]: true }
        : current,
    );

  const groupQuery = api.group.getGroupDetails.useQuery(
    { groupId },
    { enabled: !!groupId, ...SEED_QUERY_OPTIONS },
  );
  const friendQuery = api.user.getFriend.useQuery(
    { friendId },
    { enabled: !!friendId, ...SEED_QUERY_OPTIONS },
  );
  const expenseQuery = api.user.getExpenseDetails.useQuery(
    { expenseId: expenseId ?? '' },
    { enabled: !!expenseId, ...SEED_QUERY_OPTIONS },
  );

  const hasSeedError =
    meQuery.isError ||
    (!!groupId && (groupQuery.isError || null === groupQuery.data)) ||
    (!!friendId && (friendQuery.isError || null === friendQuery.data)) ||
    (!!expenseId && expenseQuery.isError);

  useEffect(() => {
    const group = groupQuery.data;
    if (!canSeed('group') || !currentUser || group?.id !== groupId) {
      return;
    }

    selectGroup(
      group,
      group.groupUsers.map((groupUser) => groupUser.user),
    );
    useAddExpenseStore.setState({ showFriends: false });
    markSeeded('group');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, groupQuery.data, currentUser]);

  useEffect(() => {
    const friend = friendQuery.data;
    if (!canSeed('friend') || !currentUser || friend?.id !== friendId) {
      return;
    }

    setParticipants([currentUser, friend]);
    useAddExpenseStore.setState({ showFriends: false });
    markSeeded('friend');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, friendQuery.data, currentUser]);

  useEffect(() => {
    const expense = expenseQuery.data;
    if (!canSeed('expense') || !expense || expense.id !== expenseId) {
      return;
    }

    useAddExpenseStore.setState(getEditFormState(expense));
    markSeeded('expense');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, expenseQuery.data, currentUser]);

  const isReady = !!currentUser && isFormReady;
  const snapshot = useAddExpenseStore(getFormSnapshot);
  const allowClose = useConfirmDiscard(isReady && snapshot !== form?.seeded);
  const { save, isSaving, isSaveDisabled, isAmountTooLarge } = useSaveExpense(
    expenseId,
    allowClose,
  );

  const close = () => goBackOr();
  // Android's header is opaque, so only iOS content starts under it.
  const headerHeight = useHeaderHeight();
  const headerInset = 'ios' === Platform.OS ? headerHeight : 0;

  const content = (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: headerInset + spacing[2] }]}
      scrollIndicatorInsets={{ top: headerInset }}
      // Scrolls under the transparent header, and above the keyboard. The inset is set by hand:
      // the header turns transparent after the screen mounts (see below), and the automatic
      // inset would then leave the form scrolled down by the header's height.
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {isReady ? (
        <AddExpenseForm expenseId={expenseId} isAmountTooLarge={isAmountTooLarge} />
      ) : hasSeedError ? (
        <EmptyState
          icon={icons.error}
          title={t('expense.form_error')}
          actionLabel={t('expense.add_new')}
          onAction={() => router.replace('/add')}
        />
      ) : (
        <View style={styles.loading}>
          <Spinner size="large" />
        </View>
      )}
    </ScrollView>
  );

  return (
    <>
      {'android' === Platform.OS ? (
        // Edge to edge, the window doesn't resize for the keyboard. iOS insets the scroll view.
        <KeyboardAvoidingView style={styles.fill} behavior="padding">
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
      <Stack.Screen
        options={{
          title: expenseId ? t('expense.edit_title') : t('expense.add_title'),
          headerShadowVisible: false,
        }}
      />
      <ModalHeader
        onCancel={close}
        confirm={
          isReady
            ? {
                label: t('expense.save'),
                onPress: save,
                disabled: isSaveDisabled,
                loading: isSaving,
              }
            : undefined
        }
      />
    </>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing[8],
  },
  loading: {
    alignItems: 'center',
    paddingTop: spacing[12] * 2,
  },
});

export default AddExpense;
