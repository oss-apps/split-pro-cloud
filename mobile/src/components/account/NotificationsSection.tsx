import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Switch } from 'react-native';

import {
  ListRow,
  SETTINGS_ICON_SIZE,
  Section,
  SettingsIcon,
  Spinner,
  icons,
  rowInset,
  toast,
} from '@/components/ui';
import { confirmAction, showMessage } from '@/lib/dialogs';
import { type PushState, disablePush, enablePush, getPushState } from '@/lib/push';
import { useAuthStore } from '@/store/authStore';
import { colors } from '@/theme/tokens';

/**
 * The account screen's notification switch, the native take on the web's
 * src/components/Account/SubscribeNotification.tsx. Turning it on shows the system permission
 * prompt; if notifications were denied before, an alert offers to open Settings.
 */
export const NotificationsSection: React.FC = () => {
  const { t } = useTranslation();
  const sessionToken = useAuthStore((state) => state.token);
  const [state, setState] = useState<PushState | null>(null);
  /** The value the switch moved to while the change is in flight. */
  const [pending, setPending] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    getPushState()
      .then(setState)
      .catch((error: unknown) => {
        console.warn(error);
        setState('unsupported');
      });
  }, []);

  // The user may change the permission in Settings while the app is in the background.
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (appState) => {
      if ('active' === appState) {
        refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const turnOn = async (token: string) => {
    const result = await enablePush(token);

    if ('enabled' === result) {
      toast.success(t('notifications.enabled'));
      return;
    }

    if ('denied' === result) {
      confirmAction({
        title: t('notifications.denied_title'),
        message: t('notifications.denied_message'),
        confirmLabel: t('notifications.open_settings'),
        cancelLabel: t('common.cancel'),
        onConfirm: () => void Linking.openSettings().catch(console.warn),
      });
      return;
    }

    showMessage(
      t('notifications.title'),
      t('unsupported' === result ? 'notifications.unsupported' : 'notifications.unavailable'),
      t('notifications.ok'),
    );
  };

  const toggle = async (value: boolean) => {
    if (!sessionToken) {
      return;
    }

    setPending(value);

    try {
      if (value) {
        await turnOn(sessionToken);
      } else {
        await disablePush(sessionToken);
        toast.success(t('notifications.disabled'));
      }
    } catch (error) {
      console.warn(error);
      toast.error(t('notifications.failed'));
    } finally {
      setPending(null);
      refresh();
    }
  };

  const isUnsupported = 'unsupported' === state;

  return (
    <Section
      footer={t(isUnsupported ? 'notifications.unsupported' : 'notifications.hint')}
      separatorInset={rowInset(SETTINGS_ICON_SIZE)}
    >
      <ListRow
        left={<SettingsIcon name={icons.notifications} color="red" />}
        title={t('notifications.title')}
        right={
          null === state ? (
            <Spinner />
          ) : (
            <Switch
              value={pending ?? 'enabled' === state}
              onValueChange={(value) => void toggle(value)}
              disabled={isUnsupported || null !== pending}
              trackColor={{ true: colors.tint }}
              accessibilityLabel={t('notifications.title')}
            />
          )
        }
      />
    </Section>
  );
};
