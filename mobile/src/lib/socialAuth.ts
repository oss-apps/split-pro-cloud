import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import i18n from '@/i18n';

import {
  AuthApiError,
  type SignInResult,
  exchangeHandoffCode,
  googleSignInUrl,
  signInWithAppleToken,
} from './authApi';
import { VERIFIER_BYTE_LENGTH, createCodeChallenge, createCodeVerifier } from './pkce';

/** Mirrors EMAIL_TOKEN_LENGTH / EMAIL_TOKEN_ALPHABET in ../src/server/auth.ts. */
export const EMAIL_CODE_LENGTH = 6;
export const EMAIL_CODE_CHARACTER = /[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/;

/**
 * Where the browser sends the user back after the Google sign-in. On Android the redirect also
 * reaches Expo Router as a deep link, so `(auth)/oauth-callback.tsx` exists to absorb it.
 */
export const GOOGLE_REDIRECT_PATH = 'oauth-callback';

const signInFailed = () => new AuthApiError(i18n.t('auth.sign_in_failed'), 0);

const isCancelled = (error: unknown) =>
  error instanceof Error && 'code' in error && 'ERR_REQUEST_CANCELED' === error.code;

export const isAppleSignInAvailable = async () =>
  'ios' === Platform.OS && AppleAuthentication.isAvailableAsync();

/**
 * Native Sign in with Apple. Resolves `null` when the user cancels. Needs a development build with
 * the Sign in with Apple capability (it doesn't work in Expo Go).
 */
export const signInWithApple = async (): Promise<SignInResult | null> => {
  let credential: AppleAuthentication.AppleAuthenticationCredential;

  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    if (isCancelled(error)) {
      return null;
    }
    console.warn('Sign in with Apple failed', error);
    throw signInFailed();
  }

  if (!credential.identityToken) {
    throw signInFailed();
  }

  return signInWithAppleToken(credential.identityToken, credential.fullName);
};

/**
 * A fresh authorization code from Sign in with Apple, which the server exchanges to revoke the
 * user's Apple sign-in when they delete their account. Resolves `null` when the user cancels.
 */
export const getAppleAuthorizationCode = async (): Promise<string | null> => {
  try {
    const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });

    if (!credential.authorizationCode) {
      throw new Error('Sign in with Apple returned no authorization code');
    }

    return credential.authorizationCode;
  } catch (error) {
    if (isCancelled(error)) {
      return null;
    }
    throw error;
  }
};

const sha256 = (data: Uint8Array<ArrayBuffer>) =>
  Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);

/**
 * Google sign-in through the web app: the browser signs in with next-auth, then the server
 * redirects back to the app with a one-time code that only this PKCE verifier can redeem.
 * Resolves `null` when the user closes the browser.
 *
 * On iOS the auth session is ephemeral, so a splitpro.app session already in Safari isn't reused
 * (next-auth would link the chosen Google account to that signed-in user). The tradeoff is that
 * Google's own cookies aren't shared either, so the user picks or types their Google account each
 * time. Android Custom Tabs have no such option and share Chrome's cookies.
 */
export const signInWithGoogle = async (): Promise<SignInResult | null> => {
  // The redirect is a custom scheme, which a web popup can't hand back
  if ('web' === Platform.OS) {
    throw new AuthApiError(i18n.t('auth.not_available'), 0);
  }

  const verifier = createCodeVerifier(await Crypto.getRandomBytesAsync(VERIFIER_BYTE_LENGTH));
  const challenge = await createCodeChallenge(verifier, sha256);
  const redirect = Linking.createURL(GOOGLE_REDIRECT_PATH);

  const result = await WebBrowser.openAuthSessionAsync(
    googleSignInUrl(challenge, redirect),
    redirect,
    { preferEphemeralSession: true },
  );

  if ('success' !== result.type) {
    return null;
  }

  // The handoff redirects with `?code=` on success, `?error=invalid_state|unauthenticated` if not
  const { code } = Linking.parse(result.url).queryParams ?? {};

  if ('string' !== typeof code || '' === code) {
    throw signInFailed();
  }

  return exchangeHandoffCode(code, verifier);
};
