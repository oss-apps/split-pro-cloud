import { type Href } from 'expo-router';

/** Screens a signed-out user can open anyway, so there's nothing to come back to. */
const PUBLIC_PATHS = ['/', '/sign-in', '/verify', '/oauth-callback'];

/**
 * The app path, with its query, that a link opens: `splitpro://join-group?groupId=x`,
 * `https://splitpro.app/join-group?groupId=x` and Expo Go's `exp://host/--/join-group?groupId=x` all
 * give `/join-group?groupId=x`. `null` for the start and sign-in screens and Expo's own dev links.
 */
export const getLinkPath = (url: string | null | undefined): string | null => {
  if (!url || url.includes('expo-development-client')) {
    return null;
  }

  const devPathStart = url.indexOf('/--/');
  const match = /^([a-z][a-z\d+.-]*):\/\/([^/?#]*)(.*)$/i.exec(url);

  if (-1 === devPathStart && !match) {
    return null;
  }

  // A custom scheme has no host: `splitpro://join-group` means the path `/join-group`.
  const [, scheme = '', host = '', rest = ''] = match ?? [];
  const path =
    -1 !== devPathStart
      ? url.slice(devPathStart + 3)
      : /^(https?|exps?)$/i.test(scheme)
        ? rest
        : `/${host}${rest}`;
  const [pathname = '', query = ''] = path.replace(/#.*$/, '').split('?');
  const cleanPath = `/${pathname.replace(/^\/+|\/+$/g, '')}`;

  if (PUBLIC_PATHS.includes(cleanPath)) {
    return null;
  }

  return query ? `${cleanPath}?${query}` : cleanPath;
};

let pendingPath: string | null = null;

/** Remembers where a link opened while signed out was going, to open it after sign-in. */
export const savePendingLink = (url: string | null | undefined) => {
  const path = getLinkPath(url);

  if (path) {
    pendingPath = path;
  }
};

/** Whether a link saved while signed out is waiting to be opened. */
export const hasPendingLink = () => null !== pendingPath;

/** The link saved while signed out, once. */
export const takePendingLink = () => {
  const path = pendingPath;
  pendingPath = null;
  return path as Href | null;
};
