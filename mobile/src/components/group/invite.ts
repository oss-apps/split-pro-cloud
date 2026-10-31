import { type TFunction } from 'i18next';
import { Platform, Share } from 'react-native';

import { toast } from '@/components/ui';
import { API_URL } from '@/lib/config';

/** The web's invite link. The app opens it too, as `splitpro://join-group?groupId=…`. */
export const getInviteLink = (publicId: string) =>
  `${API_URL}/join-group?groupId=${encodeURIComponent(publicId)}`;

const copyOnWeb = async (url: string, t: TFunction) => {
  await globalThis.navigator?.clipboard?.writeText(url);
  toast.success(t('groups.link_copied'));
};

/** Opens the share sheet with the group's invite link (copies it on browsers without one). */
export const shareInviteLink = async (group: { name: string; publicId: string }, t: TFunction) => {
  const url = getInviteLink(group.publicId);
  const title = t('groups.invite_title', { name: group.name });
  const message = t('groups.invite_message');

  if ('web' === Platform.OS && !globalThis.navigator?.share) {
    await copyOnWeb(url, t);
    return;
  }

  try {
    // iOS shares `url` as a link next to the message; Android only shares `message`.
    await Share.share(
      'ios' === Platform.OS ? { title, message, url } : { title, message: `${message}\n${url}` },
      { dialogTitle: title, subject: title },
    );
  } catch (error) {
    if ('web' === Platform.OS) {
      // The browser's share sheet was dismissed or isn't allowed here.
      if (error instanceof Error && 'AbortError' === error.name) {
        return;
      }
      await copyOnWeb(url, t);
      return;
    }
    console.warn(error);
  }
};
