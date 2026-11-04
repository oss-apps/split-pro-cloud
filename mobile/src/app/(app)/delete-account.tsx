import { TRPCClientError } from '@trpc/client';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  CodeInput,
  Icon,
  ListRow,
  ModalHeader,
  Money,
  SETTINGS_ICON_SIZE,
  Section,
  SettingsIcon,
  Skeleton,
  Text,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDuration, useSecondsLeft } from '@/lib/countdown';
import { goBackOr } from '@/lib/navigation';
import {
  EMAIL_CODE_CHARACTER,
  EMAIL_CODE_LENGTH,
  getAppleAuthorizationCode,
} from '@/lib/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { colors, spacing } from '@/theme/tokens';

const iconInset = rowInset(SETTINGS_ICON_SIZE);

/** When the server asked to wait (too many codes or guesses), from the error's data. */
const lockedUntil = (error: unknown) => {
  const seconds =
    error instanceof TRPCClientError && 'TOO_MANY_REQUESTS' === error.data?.code
      ? (error.data as { retryAfterSeconds?: number | null }).retryAfterSeconds
      : null;
  return seconds ? Date.now() + seconds * 1000 : null;
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof TRPCClientError ? error.message : fallback;

/**
 * Deletes the account, as the App Store requires: what happens first, then the code we email,
 * and for accounts linked to Apple a quick Sign in with Apple so the server can revoke it.
 */
const DeleteAccount = () => {
  const { t } = useTranslation();
  const forgetDeletedAccount = useAuthStore((state) => state.forgetDeletedAccount);
  const infoQuery = api.user.getDeleteAccountInfo.useQuery();
  const requestCode = api.user.requestDeleteAccountCode.useMutation();
  const deleteAccount = api.user.deleteAccount.useMutation();
  const [step, setStep] = useState<'explain' | 'code'>('explain');
  const [email, setEmail] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingApple, setConfirmingApple] = useState(false);
  const [resendLockedUntil, setResendLockedUntil] = useState<number | null>(null);
  const [verifyLockedUntil, setVerifyLockedUntil] = useState<number | null>(null);
  const resendSecondsLeft = useSecondsLeft(resendLockedUntil);
  const verifySecondsLeft = useSecondsLeft(verifyLockedUntil);
  const isLocked = 0 < verifySecondsLeft;
  const info = infoQuery.data;
  const deleting = deleteAccount.isLoading || confirmingApple;

  const sendCode = async () => {
    try {
      const sent = await requestCode.mutateAsync();
      setEmail(sent.email);
      setCode('');
      setError(null);
      setVerifyLockedUntil(null);
      setResendLockedUntil(Date.now() + sent.resendAfterSeconds * 1000);
      if ('code' === step) {
        toast.success(t('auth.code_resent'));
      }
      setStep('code');
    } catch (sendError) {
      const until = lockedUntil(sendError);
      if (until) {
        setResendLockedUntil(until);
      }
      // A code sent a moment ago still works, so go on to enter it
      if (until && 'explain' === step && info?.email) {
        setEmail(info.email);
        setStep('code');
        return;
      }
      toast.error(errorMessage(sendError, t('common.something_went_wrong')));
    }
  };

  const confirmDelete = async () => {
    if (deleting || isLocked) {
      return;
    }

    if (EMAIL_CODE_LENGTH !== code.length) {
      setError(t('auth.code_invalid_length', { length: EMAIL_CODE_LENGTH }));
      return;
    }

    let appleAuthorizationCode: string | undefined;

    // Apple asks us to revoke its sign-in, which needs a fresh code from the user's Apple ID
    if (info?.hasAppleAccount && 'ios' === Platform.OS) {
      setConfirmingApple(true);
      try {
        const appleCode = await getAppleAuthorizationCode();
        if (null === appleCode) {
          return;
        }
        appleAuthorizationCode = appleCode;
      } catch (appleError) {
        // Best effort, like on the server: the account is deleted either way
        console.warn('Sign in with Apple failed', appleError);
      } finally {
        setConfirmingApple(false);
      }
    }

    setError(null);

    try {
      await deleteAccount.mutateAsync({ code, appleAuthorizationCode });
    } catch (deleteError) {
      const until = lockedUntil(deleteError);
      if (until) {
        // Too many guesses burn the code
        setCode('');
        setVerifyLockedUntil(until);
      } else {
        setError(errorMessage(deleteError, t('common.something_went_wrong')));
      }
      return;
    }

    // Signed out like Sign out does; the protected routes go back to sign-in
    await forgetDeletedAccount();
    toast.success(t('account.delete_done'));
  };

  if ('code' === step) {
    const status = isLocked
      ? t('auth.too_many_attempts', { time: formatDuration(verifySecondsLeft) })
      : error;

    return (
      <>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.codeContent}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Icon name={icons.mail} size={44} color={colors.tint} />
            <Text variant="title2" weight="bold" align="center" accessibilityRole="header">
              {t('auth.code_title')}
            </Text>
            <Text variant="callout" color="secondaryLabel" align="center">
              {t('account.delete_code_sent', { email: email ?? '' })}
            </Text>
          </View>

          <View
            style={isLocked ? styles.locked : null}
            pointerEvents={isLocked ? 'none' : 'auto'}
            accessibilityState={{ disabled: isLocked }}
          >
            <CodeInput
              value={code}
              onChange={(value) => {
                setCode(value);
                setError(null);
              }}
              length={EMAIL_CODE_LENGTH}
              allowed={EMAIL_CODE_CHARACTER}
              autoFocus
              error={!!error || isLocked}
            />
          </View>
          {status ? (
            <Text
              variant="footnote"
              color="destructive"
              align="center"
              accessibilityLiveRegion="polite"
            >
              {status}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              variant="destructive"
              size="large"
              fullWidth
              title={deleting ? t('account.delete_deleting') : t('account.delete_account')}
              loading={deleting}
              disabled={isLocked || EMAIL_CODE_LENGTH !== code.length}
              onPress={() => void confirmDelete()}
            />
            <Button
              variant="plain"
              title={
                0 < resendSecondsLeft
                  ? t('auth.resend_code_in', { time: formatDuration(resendSecondsLeft) })
                  : t('auth.resend_code')
              }
              loading={requestCode.isLoading}
              disabled={0 < resendSecondsLeft || deleting}
              onPress={() => void sendCode()}
            />
          </View>
        </ScrollView>
        <ModalHeader
          title={t('account.delete_account')}
          onBack={deleting ? undefined : () => setStep('explain')}
        />
      </>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.header}>
          <Icon name={icons.personMissing} size={48} color={colors.destructive} />
          <Text variant="title2" weight="bold" align="center" accessibilityRole="header">
            {t('account.delete_title')}
          </Text>
        </View>

        <Section separatorInset={iconInset}>
          <ListRow
            left={<SettingsIcon name={icons.person} color="gray" />}
            title={<Text>{t('account.delete_removed')}</Text>}
          />
          <ListRow
            left={<SettingsIcon name={icons.receipt} color="blue" />}
            title={<Text>{t('account.delete_shared')}</Text>}
          />
          <ListRow
            left={<SettingsIcon name={icons.error} color="red" />}
            title={<Text>{t('account.delete_permanent')}</Text>}
          />
        </Section>

        {!info ? (
          <Section>
            <View style={styles.loadingRow}>
              <Skeleton width={180} height={16} />
            </View>
          </Section>
        ) : null}

        {info && 0 < info.balances.length ? (
          <Section
            header={t('account.delete_balances')}
            footer={t('account.delete_balances_footer')}
          >
            {info.balances.map((balance) => (
              <ListRow
                key={balance.currency}
                title={0 < balance.amount ? t('balances.you_get') : t('balances.you_owe')}
                right={<Money amount={balance.amount} currency={balance.currency} mode="balance" />}
              />
            ))}
          </Section>
        ) : null}

        {info && 0 < info.groups.length ? (
          <Section header={t('account.delete_groups')} footer={t('account.delete_groups_footer')}>
            {info.groups.map((group) => (
              <ListRow
                key={group.id}
                title={group.name}
                detail={
                  group.nextOwnerName
                    ? t('account.delete_group_next_owner', { name: group.nextOwnerName })
                    : group.willBeDeleted
                      ? t('account.delete_group_deleted')
                      : undefined
                }
              />
            ))}
          </Section>
        ) : null}

        <View style={styles.footer}>
          <Button
            variant="destructive"
            size="large"
            fullWidth
            title={t('account.delete_account')}
            loading={requestCode.isLoading}
            disabled={!info}
            onPress={() => void sendCode()}
          />
          <Text variant="footnote" color="secondaryLabel" align="center">
            {info?.email
              ? t('account.delete_code_hint', { email: info.email })
              : t('account.delete_code_hint_no_email')}
          </Text>
        </View>
      </ScrollView>
      <ModalHeader title={t('account.delete_account')} onCancel={() => goBackOr('/account')} />
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
    paddingBottom: spacing[8],
  },
  codeContent: {
    flexGrow: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    paddingTop: spacing[6],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[6],
  },
  header: {
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[6],
    paddingBottom: spacing[4],
  },
  loadingRow: {
    padding: spacing[4],
  },
  locked: {
    opacity: 0.5,
  },
  actions: {
    gap: spacing[2],
  },
  footer: {
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
});

export default DeleteAccount;
