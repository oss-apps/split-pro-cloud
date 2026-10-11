import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useEffect, useRef, useState } from 'react';
import { AddOrEditExpensePage } from '~/components/AddExpense/AddExpensePage';
import MainLayout from '~/components/Layout/MainLayout';
import { env } from '~/env';
import { isStorageConfigured } from '~/server/storage';
import { calculateSplitShareBasedOnAmount, useAddExpenseStore } from '~/store/addStore';
import { type NextPageWithUser } from '~/types';
import { api } from '~/utils/api';
import { toFixedNumber } from '~/utils/numbers';

// 🧾

// Refetching these would re-seed the form and wipe what the user entered, e.g. after switching apps.
const SEED_QUERY_OPTIONS = { refetchOnWindowFocus: false, refetchOnReconnect: false } as const;

const AddPage: NextPageWithUser<{
  isStorageConfigured: boolean;
  enableSendingInvites: boolean;
}> = ({ user, isStorageConfigured, enableSendingInvites }) => {
  const { setCurrentUser, setGroup, setParticipants, resetState } = useAddExpenseStore(
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

  // The form is seeded at most once per group, friend and expense, so refetches never overwrite edits.
  const seededGroupId = useRef<number | null>(null);
  const seededFriendId = useRef<number | null>(null);
  const [seededExpenseId, setSeededExpenseId] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const isFormReady = resetFor === formKey;

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
    seededGroupId.current = null;
    seededFriendId.current = null;
    setSeededExpenseId(null);
    setResetFor(formKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  useEffect(() => () => resetState(), [resetState]);

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

  useEffect(() => {
    if (!_groupId) {
      seededGroupId.current = null;
      return;
    }

    if (!isFormReady || seededGroupId.current === _groupId || !groupQuery.data || !currentUser) {
      return;
    }

    seededGroupId.current = _groupId;
    setGroup(groupQuery.data);
    setParticipants([
      currentUser,
      ...groupQuery.data.groupUsers.map((gu) => gu.user).filter((u) => u.id !== currentUser.id),
    ]);
    useAddExpenseStore.setState({ showFriends: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_groupId, isFormReady, groupQuery.data, currentUser]);

  useEffect(() => {
    if (!_friendId) {
      seededFriendId.current = null;
      return;
    }

    if (!isFormReady || seededFriendId.current === _friendId || !friendQuery.data || !currentUser) {
      return;
    }

    seededFriendId.current = _friendId;
    setParticipants([currentUser, friendQuery.data]);
    useAddExpenseStore.setState({ showFriends: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_friendId, isFormReady, friendQuery.data, currentUser]);

  useEffect(() => {
    if (!_expenseId || !isFormReady || seededExpenseId === _expenseId || !expenseQuery.data) {
      return;
    }

    const amount = toFixedNumber(expenseQuery.data.amount);
    const participants = calculateSplitShareBasedOnAmount(
      amount,
      expenseQuery.data.expenseParticipants.map((participant) => ({
        ...participant.user,
        amount: toFixedNumber(participant.amount),
      })),
      expenseQuery.data.splitType,
      expenseQuery.data.paidByUser,
    );

    useAddExpenseStore.setState({
      amount,
      amountStr: amount.toString(),
      canSplitScreenClosed: true,
      category: expenseQuery.data.category,
      currency: expenseQuery.data.currency,
      description: expenseQuery.data.name,
      expenseDate: expenseQuery.data.expenseDate,
      fileKey: expenseQuery.data.fileKey ?? undefined,
      group: expenseQuery.data.group ?? undefined,
      paidBy: expenseQuery.data.paidByUser,
      participants,
      showFriends: false,
      splitType: expenseQuery.data.splitType,
    });
    setSeededExpenseId(_expenseId);
  }, [_expenseId, isFormReady, seededExpenseId, expenseQuery.data]);

  const isExpenseSeeded = !_expenseId || seededExpenseId === _expenseId;

  return (
    <>
      <Head>
        <title>Add Expense</title>
      </Head>
      <MainLayout hideAppBar>
        {currentUser && isFormReady && isExpenseSeeded ? (
          <AddOrEditExpensePage
            isStorageConfigured={isStorageConfigured}
            enableSendingInvites={enableSendingInvites}
            expenseId={_expenseId}
          />
        ) : (
          <div></div>
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
