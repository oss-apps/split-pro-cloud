import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { FriendSettleUp, GroupSettleUp } from '@/components/settle';
import { SettleHeader } from '@/components/settle/shared';
import { EmptyState, icons } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

const toId = (value: string | undefined) => {
  const id = Number(value);
  return Number.isInteger(id) && 0 < id ? id : undefined;
};

/**
 * Settle-up form sheet. `?friendId=` settles with a friend across all balances or one shared group;
 * `?groupId=` (optionally with `friendId`) settles inside that group only. Each step sets the
 * sheet's native header (title, Close/Back, Save).
 */
const SettleUp = () => {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ friendId?: string; groupId?: string }>();
  const friendId = toId(params.friendId);
  const groupId = toId(params.groupId);

  const content = (() => {
    if (groupId) {
      return <GroupSettleUp groupId={groupId} friendId={friendId} />;
    }

    if (friendId) {
      return <FriendSettleUp friendId={friendId} />;
    }

    return (
      <>
        <SettleHeader title={t('screens.settle_up')} />
        <EmptyState
          icon={icons.settle}
          title={t('screens.settle_up')}
          description={t('balances.settle.missing_params')}
        />
      </>
    );
  })();

  return (
    <>
      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {content}
      </ScrollView>
      {/* The layout hides the header; each step shows its title and buttons in it instead */}
      <Stack.Screen
        options={{
          headerShown: true,
          contentStyle: { backgroundColor: colors.groupedBackground },
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing[8],
  },
});

export default SettleUp;
