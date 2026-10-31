import * as SecureStore from 'expo-secure-store';

/**
 * Small key-value storage for the session and app preferences: the Keychain / Keystore through
 * SecureStore on iOS and Android. `storage.web.ts` is the web build's version. Keys may only use
 * letters, digits, `.`, `-` and `_`.
 */
export const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
