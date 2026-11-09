import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { Input, ModalHeader, Section, icons, toast } from '@/components/ui';
import { api } from '@/lib/api';
import { type DraftKey, keyForDraft } from '@/lib/draftKey';
import { goBackOr, useConfirmDiscard } from '@/lib/navigation';
import { colors, spacing } from '@/theme/tokens';

/** The server's `submitFeedback` limits. */
const MIN_LENGTH = 10;
const MAX_LENGTH = 5000;

/** Port of the web's src/components/Account/SubmitFeedback.tsx, as a modal form. */
const Feedback = () => {
  const { t } = useTranslation();
  const submitFeedback = api.user.submitFeedback.useMutation();
  const [feedback, setFeedback] = useState('');
  // Resending the same text (a double tap, a retry after an error) reuses its key, so it's saved
  // once; edited text gets a new one
  const draftKey = useRef<DraftKey | null>(null);
  // Covers taps before the header re-renders with the spinner
  const submitting = useRef(false);
  const trimmed = feedback.trim();
  const tooLong = MAX_LENGTH < trimmed.length;
  const allowClose = useConfirmDiscard(0 < trimmed.length && !submitFeedback.isLoading);

  const submit = async () => {
    if (MIN_LENGTH > trimmed.length || tooLong || submitting.current) {
      return;
    }

    submitting.current = true;
    draftKey.current = keyForDraft(draftKey.current, trimmed, () => Crypto.randomUUID());
    try {
      await submitFeedback.mutateAsync({
        feedback: trimmed,
        clientKey: draftKey.current.key,
        source: 'ios' === Platform.OS ? 'ios' : 'android',
        appVersion: Constants.expoConfig?.version,
      });
    } catch (error) {
      console.warn(error);
      toast.error(t('account.feedback_failed'));
      return;
    } finally {
      submitting.current = false;
    }

    toast.success(t('account.feedback_sent'));
    allowClose();
    goBackOr('/account');
  };

  return (
    // The scroll view comes first, so it scrolls under the header.
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Section
          footer={tooLong ? t('account.feedback_too_long') : t('account.feedback_too_short')}
        >
          <Input
            inline
            placeholder={t('account.feedback_placeholder')}
            value={feedback}
            onChangeText={setFeedback}
            multiline
            autoFocus
            textAlignVertical="top"
            style={styles.input}
            accessibilityLabel={t('account.feedback')}
          />
        </Section>
      </ScrollView>
      <ModalHeader
        title={t('account.feedback')}
        onCancel={() => goBackOr('/account')}
        confirm={{
          label: t('account.feedback_submit'),
          icon: icons.sendFill,
          disabled: MIN_LENGTH > trimmed.length || tooLong,
          loading: submitFeedback.isLoading,
          onPress: () => void submit(),
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
  content: {
    paddingTop: spacing[4],
  },
  input: {
    minHeight: 180,
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
  },
});

export default Feedback;
