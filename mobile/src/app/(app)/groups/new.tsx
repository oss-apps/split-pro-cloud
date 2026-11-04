import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useCurrentUser } from '@/components/expense';
import {
  Avatar,
  CurrencySheet,
  Input,
  ListRow,
  ModalHeader,
  Screen,
  Section,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { getCurrency } from '@/lib/money';
import { useConfirmDiscard } from '@/lib/navigation';
import { spacing } from '@/theme/tokens';

/** Create a group, like the web's src/components/group/CreateGroup.tsx drawer. */
const NewGroup = () => {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const utils = api.useUtils();
  const createGroup = api.group.create.useMutation();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Every new group starts from the user's own currency.
  const groupCurrency = currency ?? getCurrency(user?.currency ?? '')?.code ?? 'USD';
  const currencyName = getCurrency(groupCurrency)?.name;
  const allowClose = useConfirmDiscard('' !== name.trim() || undefined !== currency);

  const onSubmit = () => {
    const trimmed = name.trim();

    if ('' === trimmed) {
      setNameError(t('groups.name_required'));
      return;
    }

    createGroup.mutate(
      { name: trimmed, currency: groupCurrency },
      {
        onSuccess: (group) => {
          void utils.group.getAllGroupsWithBalances.invalidate();
          void utils.group.getAllGroups.invalidate();
          allowClose();
          router.dismiss();
          router.push({ pathname: '/groups/[groupId]', params: { groupId: String(group.id) } });
        },
        onError: (error) => toast.error(error.message || t('common.something_went_wrong')),
      },
    );
  };

  return (
    <Screen keyboard scroll edges={[]} background="grouped" padded={false}>
      <ModalHeader
        onCancel={() => router.back()}
        confirm={{
          label: t('groups.create'),
          disabled: '' === name.trim(),
          loading: createGroup.isLoading,
          onPress: onSubmit,
        }}
      />

      <View style={styles.avatar}>
        <Avatar name={name.trim() || '?'} size={72} />
      </View>

      <Section footer={nameError ?? undefined}>
        <Input
          inline
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameError(null);
          }}
          placeholder={t('groups.name_placeholder')}
          accessibilityLabel={t('groups.name_placeholder')}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
          maxLength={100}
        />
      </Section>

      <Section footer={t('groups.currency_hint')}>
        <ListRow
          title={t('groups.currency')}
          detail={currencyName ? `${groupCurrency} · ${currencyName}` : groupCurrency}
          accessory="chevron"
          onPress={() => setPickerOpen(true)}
        />
      </Section>

      <CurrencySheet
        visible={pickerOpen}
        value={groupCurrency}
        onChange={setCurrency}
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
});

export default NewGroup;
