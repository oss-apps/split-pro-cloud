import { Alert } from 'react-native';

/** Inlined by Expo at bundle time; never enable writes in the comparison builds. */
export const PROTOTYPE_READONLY = '1' === process.env.EXPO_PUBLIC_PROTOTYPE_READONLY;
export const PROTOTYPE_MESSAGE = 'Prototype build: saving is turned off';

export const blockPrototypeWrite = () => {
  if (!PROTOTYPE_READONLY) return false;
  Alert.alert('Read-only prototype', PROTOTYPE_MESSAGE);
  return true;
};

/** All tRPC mutations use POST. Reject before a request can leave the device. */
export const prototypeFetch: typeof fetch = (input, init) => {
  if (PROTOTYPE_READONLY && 'GET' !== (init?.method ?? 'GET').toUpperCase()) {
    blockPrototypeWrite();
    return Promise.reject(new Error(PROTOTYPE_MESSAGE));
  }
  return fetch(input, init);
};
