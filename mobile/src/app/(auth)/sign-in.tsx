import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { z } from 'zod';

import { Button, Input, Screen, Spinner, Text, toast } from '@/components/ui';
import { AuthApiError, type SignInResult, getAuthProviders, sendEmailCode } from '@/lib/authApi';
import { isAppleSignInAvailable, signInWithApple, signInWithGoogle } from '@/lib/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { colors, spacing } from '@/theme/tokens';

const emailSchema = z.string().trim().toLowerCase().email();
const appIcon = require('../../../assets/icon.png') as number;

const BUTTON_HEIGHT = 50;
const ICON_SIZE = 88;

type SocialProvider = 'google' | 'apple';

const SOCIAL_SIGN_IN = {
  google: signInWithGoogle,
  apple: signInWithApple,
} satisfies Record<SocialProvider, () => Promise<SignInResult | null>>;

/** Google's sign-in button colors (developers.google.com/identity/branding-guidelines). */
const GOOGLE_BUTTON = {
  light: { background: '#ffffff', border: '#747775', text: '#1f1f1f' },
  dark: { background: '#131314', border: '#8e918f', text: '#e3e3e3' },
} as const;

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof AuthApiError ? error.message : fallback;

/** Google's four-color "G". */
const GoogleLogo = () => (
  <Svg width={18} height={18} viewBox="0 0 48 48">
    <Path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <Path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <Path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <Path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </Svg>
);

const GoogleButton: React.FC<{
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}> = ({ label, loading, disabled, onPress }) => {
  const palette = GOOGLE_BUTTON['dark' === useColorScheme() ? 'dark' : 'light'];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.socialButton,
        styles.googleButton,
        { backgroundColor: palette.background, borderColor: palette.border },
        pressed ? styles.pressed : null,
        disabled && !loading ? styles.disabled : null,
      ]}
    >
      {loading ? (
        <Spinner color={palette.text} />
      ) : (
        <>
          <GoogleLogo />
          {/* Google's guidelines: the button's text follows the platform font, medium weight */}
          <Text weight="semibold" style={{ color: palette.text }} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
};

const SignIn = () => {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const signIn = useAuthStore((state) => state.signIn);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [socialPending, setSocialPending] = useState<SocialProvider | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  // null until the server answers: show every option rather than none if it can't be reached
  const [providers, setProviders] = useState<string[] | null>(null);
  const busy = sending || null !== socialPending;
  const showGoogle = !providers || providers.includes('google');
  const showEmail = !providers || providers.includes('email');
  const showSocial = showGoogle || appleAvailable;

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(console.warn);
    getAuthProviders().then(setProviders).catch(console.warn);
  }, []);

  const onSendCode = async () => {
    if (busy) {
      return;
    }

    const parsed = emailSchema.safeParse(email);

    if (!parsed.success) {
      setEmailError(t('auth.invalid_email'));
      return;
    }

    setEmailError(null);
    setSending(true);

    try {
      await sendEmailCode(parsed.data);
      router.push({ pathname: '/verify', params: { email: parsed.data } });
    } catch (error) {
      setEmailError(errorMessage(error, t('common.something_went_wrong')));
    } finally {
      setSending(false);
    }
  };

  const onSocialSignIn = async (provider: SocialProvider) => {
    if (busy) {
      return;
    }

    setSocialPending(provider);

    try {
      const result = await SOCIAL_SIGN_IN[provider]();

      // Signing in flips the protected routes, which replaces this screen with the app
      if (result) {
        await signIn(result);
      }
    } catch (error) {
      toast.error(errorMessage(error, t('auth.sign_in_failed')));
    } finally {
      setSocialPending(null);
    }
  };

  return (
    <Screen keyboard scroll edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.brand}>
          <Image source={appIcon} style={styles.icon} accessibilityIgnoresInvertColors />
          <Text variant="largeTitle" align="center" accessibilityRole="header">
            {t('common.app_name')}
          </Text>
          <Text variant="callout" color="secondaryLabel" align="center">
            {t('auth.tagline')}
          </Text>
        </View>

        <View style={styles.form}>
          {/* HIG: Sign in with Apple is at least as prominent as other sign-in options */}
          {appleAvailable ? (
            <View
              style={[styles.socialButton, busy ? styles.disabled : null]}
              pointerEvents={busy ? 'none' : 'auto'}
              accessibilityState={{ disabled: busy, busy: 'apple' === socialPending }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                // The style can't change once mounted, so remount when the scheme changes.
                key={scheme ?? 'light'}
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  'dark' === scheme
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={BUTTON_HEIGHT / 2}
                style={StyleSheet.absoluteFill}
                onPress={() => onSocialSignIn('apple')}
              />
              {'apple' === socialPending ? (
                <View style={styles.appleSpinner}>
                  <Spinner />
                </View>
              ) : null}
            </View>
          ) : null}
          {showGoogle ? (
            <GoogleButton
              label={t('auth.continue_with_google')}
              loading={'google' === socialPending}
              disabled={busy}
              onPress={() => onSocialSignIn('google')}
            />
          ) : null}

          {showSocial && showEmail ? (
            <View style={styles.divider}>
              <View style={styles.line} />
              <Text variant="footnote">{t('auth.or')}</Text>
              <View style={styles.line} />
            </View>
          ) : null}

          {showEmail ? (
            <>
              <Input
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setEmailError(null);
                }}
                placeholder={t('auth.email_placeholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                editable={!busy}
                onSubmitEditing={onSendCode}
                error={emailError}
                accessibilityLabel={t('auth.email_placeholder')}
              />
              <Button
                size="large"
                fullWidth
                title={sending ? t('auth.sending') : t('auth.send_code')}
                loading={sending}
                disabled={busy}
                onPress={onSendCode}
              />
            </>
          ) : null}
        </View>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'space-between',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
    gap: spacing[10],
    paddingTop: spacing[12],
    paddingBottom: spacing[4],
  },
  brand: {
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[10],
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    // The app icon's squircle
    borderRadius: ICON_SIZE * 0.2237,
    borderCurve: 'continuous',
    // Keeps the dark icon's edge visible on a black background
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    marginBottom: spacing[3],
  },
  form: {
    gap: spacing[3],
  },
  socialButton: {
    height: BUTTON_HEIGHT,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    borderWidth: 1,
    borderRadius: BUTTON_HEIGHT / 2,
  },
  appleSpinner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BUTTON_HEIGHT / 2,
    backgroundColor: colors.fill,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginVertical: spacing[1],
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
});

export default SignIn;
