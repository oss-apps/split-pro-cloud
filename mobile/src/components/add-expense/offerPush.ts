import { type TFunction } from 'i18next';

import { toast } from '@/components/ui';
import { confirmAction } from '@/lib/dialogs';
import { enablePush, markPushOffered, shouldOfferPush } from '@/lib/push';
import { useAuthStore } from '@/store/authStore';

/** Lets the add-expense modal finish closing first; iOS drops alerts shown during the animation. */
const OFFER_DELAY_MS = 600;

const turnOnPush = async (sessionToken: string, t: TFunction) => {
  const result = await enablePush(sessionToken);

  if ('enabled' === result) {
    toast.success(t('notifications.enabled'));
  } else if ('unavailable' === result) {
    toast.error(t('notifications.unavailable'));
  }
};

/**
 * Once the user saved an expense, offers to turn on notifications, once per device and only while
 * the system permission was never asked for. Does nothing on web and simulators.
 */
export const offerPushAfterExpense = async (t: TFunction) => {
  const sessionToken = useAuthStore.getState().token;

  if (!sessionToken || !(await shouldOfferPush())) {
    return;
  }

  await markPushOffered();

  setTimeout(() => {
    confirmAction({
      title: t('notifications.prompt_title'),
      message: t('notifications.prompt_message'),
      confirmLabel: t('notifications.prompt_enable'),
      cancelLabel: t('notifications.prompt_later'),
      onConfirm: () => {
        turnOnPush(sessionToken, t).catch((error: unknown) => {
          console.warn(error);
          toast.error(t('notifications.failed'));
        });
      },
    });
  }, OFFER_DELAY_MS);
};
