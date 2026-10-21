import { create } from 'zustand';

import { type SessionUser, type SignInResult, signOutSession } from '@/lib/authApi';
import { forgetRegisteredPushToken, getRegisteredPushToken } from '@/lib/push';
import { storage } from '@/lib/storage';

const TOKEN_KEY = 'splitpro.sessionToken';
const USER_KEY = 'splitpro.sessionUser';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  token: string | null;
  /** The user returned at sign-in. Use `api.user.me` for fresh data. */
  user: SessionUser | null;
  /** Reads the saved session on app start. */
  hydrate: () => Promise<void>;
  signIn: (result: SignInResult) => Promise<void>;
  /** Revokes the session on the server, then forgets it locally. */
  signOut: () => Promise<void>;
  /** Forgets the session without calling the server, e.g. after a 401. */
  clearSession: () => Promise<void>;
}

const parseUser = (raw: string | null): SessionUser | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'loading',
  token: null,
  user: null,

  hydrate: async () => {
    const [token, rawUser] = await Promise.all([
      storage.getItem(TOKEN_KEY),
      storage.getItem(USER_KEY),
    ]).catch(() => [null, null]);

    if (!token) {
      set({ status: 'signedOut', token: null, user: null });
      return;
    }

    set({ status: 'signedIn', token, user: parseUser(rawUser) });
  },

  signIn: async ({ token, user }) => {
    await storage.setItem(TOKEN_KEY, token);
    await storage.setItem(USER_KEY, JSON.stringify(user));
    set({ status: 'signedIn', token, user });
  },

  signOut: async () => {
    const { token, clearSession } = get();

    if (token) {
      const pushToken = await getRegisteredPushToken().catch(() => null);
      await signOutSession(token, pushToken).catch(console.warn);
      await forgetRegisteredPushToken().catch(console.warn);
    }

    await clearSession();
  },

  clearSession: async () => {
    set({ status: 'signedOut', token: null, user: null });
    await Promise.all([storage.removeItem(TOKEN_KEY), storage.removeItem(USER_KEY)]).catch(
      console.warn,
    );
  },
}));

/** The current token, for non-React code such as the tRPC link. */
export const getAuthToken = () => useAuthStore.getState().token;
