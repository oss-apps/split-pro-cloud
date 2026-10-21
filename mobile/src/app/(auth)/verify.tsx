import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button, CodeInput, Icon, Screen, Text, icons, toast } from '@/components/ui';
import { AuthApiError, sendEmailCode, verifyEmailCode } from '@/lib/authApi';
import { EMAIL_CODE_CHARACTER, EMAIL_CODE_LENGTH } from '@/lib/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { colors, spacing } from '@/theme/tokens';

/** Whole seconds left until `until` (a timestamp), ticking every second; 0 once it has passed. */
const useSecondsLeft = (until: number | null) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (null === until) {
      return;
    }

    const tick = () => {
      const current = Date.now();
      setNow(current);

      if (current >= until) {
        clearInterval(interval);
      }
    };
    // Refresh straight away, `now` is stale from the last tick
    const timeout = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [until]);

  return null === until ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
};

const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const lockedUntil = (error: unknown) =>
  error instanceof AuthApiError && 429 === error.status && error.retryAfterSeconds
    ? Date.now() + error.retryAfterSeconds * 1000
    : null;

const Verify = () => {
  const { t } = useTranslation();
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const signIn = useAuthStore((state) => state.signIn);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  // Set from Retry-After when the server rate limits code checks or resends
  const [verifyLockedUntil, setVerifyLockedUntil] = useState<number | null>(null);
  const [resendLockedUntil, setResendLockedUntil] = useState<number | null>(null);
  const verifySecondsLeft = useSecondsLeft(verifyLockedUntil);
  const resendSecondsLeft = useSecondsLeft(resendLockedUntil);
  const isLocked = 0 < verifySecondsLeft;
  const wasLocked = null !== verifyLockedUntil && !isLocked;

  const verify = async (value: string) => {
    if (verifying || isLocked) {
      return;
    }

    if (EMAIL_CODE_LENGTH !== value.length) {
      setError(t('auth.code_invalid_length', { length: EMAIL_CODE_LENGTH }));
      return;
    }

    setError(null);
    setVerifyLockedUntil(null);
    setVerifying(true);

    try {
      // Signing in flips the protected routes, which replaces this screen with the app.
      await signIn(await verifyEmailCode(email, value));
    } catch (verifyError) {
      const until = lockedUntil(verifyError);

      if (until) {
        // Too many guesses burn the code, so start over once the lockout ends
        setCode('');
        setVerifyLockedUntil(until);
      } else {
        setError(
          verifyError instanceof AuthApiError
            ? verifyError.message
            : t('common.something_went_wrong'),
        );
      }
      setVerifying(false);
    }
  };

  const resend = async () => {
    setResending(true);

    try {
      await sendEmailCode(email);
      setCode('');
      setError(null);
      setVerifyLockedUntil(null);
      toast.success(t('auth.code_resent'));
    } catch (resendError) {
      const until = lockedUntil(resendError);

      if (until) {
        setResendLockedUntil(until);
      }
      toast.error(
        resendError instanceof AuthApiError
          ? resendError.message
          : t('common.something_went_wrong'),
      );
    } finally {
      setResending(false);
    }
  };

  const status = isLocked
    ? t('auth.too_many_attempts', { time: formatDuration(verifySecondsLeft) })
    : wasLocked
      ? t('auth.try_again_now')
      : error;

  return (
    // Under the native header (back button only), which the scroll view insets itself for.
    <Screen keyboard scroll edges={['bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Icon name={icons.mail} size={44} color={colors.tint} />
          <Text variant="title1" align="center" accessibilityRole="header">
            {t('auth.code_title')}
          </Text>
          <Text variant="callout" color="secondaryLabel" align="center">
            {t('auth.code_sent', { email })}
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
            onComplete={verify}
            autoFocus
            error={!!error || isLocked}
          />
        </View>
        {status ? (
          <Text
            variant="footnote"
            color={isLocked || error ? 'destructive' : 'secondaryLabel'}
            align="center"
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            size="large"
            fullWidth
            title={verifying ? t('auth.verifying') : t('auth.verify')}
            loading={verifying}
            disabled={isLocked}
            onPress={() => verify(code)}
          />
          <Button
            variant="plain"
            title={
              0 < resendSecondsLeft
                ? t('auth.resend_code_in', { time: formatDuration(resendSecondsLeft) })
                : t('auth.resend_code')
            }
            loading={resending}
            disabled={0 < resendSecondsLeft}
            onPress={resend}
          />
          <Button
            variant="plain"
            title={t('auth.use_another_email')}
            onPress={() => router.back()}
          />
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    gap: spacing[6],
  },
  header: {
    alignItems: 'center',
    gap: spacing[2],
  },
  locked: {
    opacity: 0.5,
  },
  actions: {
    gap: spacing[2],
  },
});

export default Verify;
