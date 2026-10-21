import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useCurrentUser } from '@/components/expense';
import { Avatar, Input, ModalHeader, Section, Text, icons, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { goBackOr, useConfirmDiscard } from '@/lib/navigation';
import { colors, spacing } from '@/theme/tokens';

/** Port of the web's src/components/Account/UpdateDetails.tsx, as a modal form like Contacts' edit. */
const EditProfile = () => {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const utils = api.useUtils();
  const updateDetails = api.user.updateUserDetail.useMutation();
  const savedName = user?.name ?? '';
  const [name, setName] = useState(savedName);
  const trimmed = name.trim();
  const isDirty = trimmed !== savedName.trim();
  const allowClose = useConfirmDiscard(isDirty && !updateDetails.isLoading);

  const save = async () => {
    if (!trimmed || !isDirty) {
      return;
    }

    try {
      await updateDetails.mutateAsync({ name: trimmed });
    } catch (error) {
      console.warn(error);
      toast.error(t('account.details_failed'));
      return;
    }

    await utils.user.me.invalidate();
    toast.success(t('account.details_updated'));
    allowClose();
    goBackOr('/account');
  };

  return (
    // The scroll view comes first, so it scrolls under the header.
    <>
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.profile}>
          <Avatar name={user?.name} email={user?.email} image={user?.image} size={96} />
          {user?.email ? (
            <Text variant="subheadline" color="secondaryLabel" align="center">
              {user.email}
            </Text>
          ) : null}
        </View>
        <Section header={t('account.name_label')}>
          <Input
            inline
            placeholder={t('account.name_placeholder')}
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
            maxLength={100}
            onSubmitEditing={() => void save()}
            accessibilityLabel={t('account.name_label')}
          />
        </Section>
      </ScrollView>
      <ModalHeader
        title={t('account.edit_details')}
        onCancel={() => goBackOr('/account')}
        confirm={{
          label: t('account.save'),
          icon: icons.check,
          disabled: !trimmed || !isDirty,
          loading: updateDetails.isLoading,
          onPress: () => void save(),
        }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  profile: {
    alignItems: 'center',
    gap: spacing[3],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
});

export default EditProfile;
