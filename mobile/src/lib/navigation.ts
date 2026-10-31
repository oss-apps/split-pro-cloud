import { type Href, router, usePreventRemove } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmAction } from './dialogs';

/** Closes the screen, or opens `fallback` if nothing is under it (it was opened from a link). */
export const goBackOr = (fallback: Href = '/balances') => {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallback);
};

/**
 * Asks before a form with unsaved changes is closed by a swipe, the Android back button or Cancel.
 * Call the returned `allowClose` right before closing the screen yourself, e.g. after saving.
 */
export const useConfirmDiscard = (isDirty: boolean) => {
  const { t } = useTranslation();
  const [isClosing, setIsClosing] = useState(false);

  const disablePrevention = usePreventRemove(isDirty && !isClosing, ({ repeat }) =>
    confirmAction({
      title: t('common.discard_title'),
      message: t('common.discard_message'),
      confirmLabel: t('common.discard'),
      cancelLabel: t('common.keep_editing'),
      destructive: true,
      onConfirm: () => {
        setIsClosing(true);
        repeat();
      },
    }),
  );

  return useCallback(() => {
    setIsClosing(true);
    disablePrevention();
  }, [disablePrevention]);
};
