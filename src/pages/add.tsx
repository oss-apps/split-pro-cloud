import Head from 'next/head';
import { useRouter } from 'next/router';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { isStorageConfigured } from '~/server/storage';
import { LoadingSpinner } from '~/components/ui/spinner';
import { getEditFormState, isCurrentForm, useAddExpenseStore } from '~/store/addStore';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';

// 🧾

// Refetching these would re-seed the form and wipe what the user entered, e.g. after switching apps.
const SEED_QUERY_OPTIONS = { refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

type SeedKey = 'group' | 'friend' | 'expense';

/** One add or edit form: the generation it belongs to, and which requested seeds have loaded. */
type FormSeeds = { formKey: string; generation: number } & Record<SeedKey, boolean>;

const AddPage: NextPageWithUser<{
  isStorageConfigured: boolean;
  enableSendingInvites: boolean;
}> = ({ user, isStorageConfigured, enableSendingInvites }) => {
  const { setCurrentUser, selectGroup, setParticipants, resetState } = useAddExpenseStore(
    (s) => s.actions,
  );
  const currentUser = useAddExpenseStore((s) => s.currentUser);

  const router = useRouter();
  const { friendId, groupId, expenseId } = router.query;

  const _groupId = parseInt(groupId as string);
  const _friendId = parseInt(friendId as string);
  const _expenseId = expenseId as string | undefined;
  // Removing a group or friend inside the form leaves the URL alone, so a change here is a
  // navigation, e.g. from a group's add page to the plain one.
  const formKey = [_expenseId, groupId, friendId].map((value) => value ?? '').join('|');

  // Each requested seed is applied once, and only to the form it was requested for, so neither a
  // refetch nor a late response for an earlier form overwrites what the user entered.
  const [form, setForm] = useState<FormSeeds | null>(null);
  const isCurrentKey = form?.formKey === formKey;
  const isFormReady = !!form && isCurrentKey && form.group && form.friend && form.expense;

  // Start from a clean form on entering the page and on every navigation to another add or edit
  // form (the page stays mounted, e.g. going from /add?groupId=… to /add).
  useEffect(() => {
    setCurrentUser({
      ...user,
      emailVerified: null,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
    });
    resetState();
    setForm({
      formKey,
      generation: useAddExpenseStore.getState().formGeneration,
      group: !_groupId,
      friend: !_friendId,
      expense: !_expenseId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  useEffect(() => () => resetState(), [resetState]);

  const canSeed = (key: SeedKey) =>
    !!form && isCurrentKey && !form[key] && isCurrentForm(form.generation) && !!currentUser;
  const markSeeded = (key: SeedKey) =>
    setForm((current) => (current?.formKey === formKey ? { ...current, [key]: true } : current));

  const groupQuery = api.group.getGroupDetails.useQuery(
    { groupId: _groupId },
    { enabled: !!_groupId, ...SEED_QUERY_OPTIONS },
  );

  const friendQuery = api.user.getFriend.useQuery(
    { friendId: _friendId },
    { enabled: !!_friendId, ...SEED_QUERY_OPTIONS },
  );

  const expenseQuery = api.user.getExpenseDetails.useQuery(
    { expenseId: _expenseId ?? '' },
    { enabled: !!_expenseId, ...SEED_QUERY_OPTIONS },
  );

  const hasSeedError =
    (!!_groupId && (groupQuery.isError || null === groupQuery.data)) ||
    (!!_friendId && (friendQuery.isError || null === friendQuery.data)) ||
    (!!_expenseId && expenseQuery.isError);

  useEffect(() => {
    const group = groupQuery.data;
    if (!canSeed('group') || !currentUser || group?.id !== _groupId) {
      return;
    }

    selectGroup(
      group,
      group.groupUsers.map((gu) => gu.user),
    );
    useAddExpenseStore.setState({ showFriends: false });
    markSeeded('group');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, groupQuery.data, currentUser]);

  useEffect(() => {
    const friend = friendQuery.data;
    if (!canSeed('friend') || !currentUser || friend?.id !== _friendId) {
      return;
    }

    setParticipants([currentUser, friend]);
    useAddExpenseStore.setState({ showFriends: false });
    markSeeded('friend');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, friendQuery.data, currentUser]);

  useEffect(() => {
    const expense = expenseQuery.data;
    if (!canSeed('expense') || !expense || expense.id !== _expenseId) {
      return;
    }

    useAddExpenseStore.setState(getEditFormState(expense));
    markSeeded('expense');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, expenseQuery.data, currentUser]);

  return (
    <>
      <Head>
        <title>Add Expense</title>
      </Head>
      <MainLayout hideAppBar>
        {currentUser && isFormReady ? (
          <AddOrEditExpensePage
            isStorageConfigured={isStorageConfigured}
            enableSendingInvites={enableSendingInvites}
            expenseId={_expenseId}
          />
        ) : hasSeedError ? (
          <div className="mt-20 flex flex-col items-center gap-4 text-sm text-gray-400">
            <p>This expense form could not be loaded.</p>
            <Link href="/add" className="text-cyan-500">
              Add a new expense
            </Link>
          </div>
        ) : (
          <div className="mt-20 flex justify-center">
            <LoadingSpinner className="text-primary" />
          </div>
        )}
      </MainLayout>
    </>
  );
};

AddPage.auth = true;

export default AddPage;

export async function getServerSideProps() {
  return {
    props: {
      isStorageConfigured: !!isStorageConfigured(),
      enableSendingInvites: !!env.ENABLE_SENDING_INVITES,
    },
  };
}
