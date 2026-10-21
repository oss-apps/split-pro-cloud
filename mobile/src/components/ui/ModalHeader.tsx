import { Stack } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { isLiquidGlassEra } from '@/theme/tokens';

import { type HeaderAction, HeaderActions } from './HeaderActions';
import { type IconName, icons } from './Icon';

/**
 * iOS 26 modals use glass ✕ and ✓ buttons, earlier iOS "Cancel" and a bold "Done" text button.
 * A Material full-screen dialog has ✕ and a text button ("Save").
 */
const cancelHasIcon = 'ios' !== Platform.OS || isLiquidGlassEra;
const confirmHasIcon = 'ios' === Platform.OS && isLiquidGlassEra;

export interface ModalHeaderProps {
  /** Sets the screen's title. Leave out when the layout sets it. */
  title?: string;
  /** Cancel (✕) on the left: closes the modal. */
  onCancel?: () => void;
  /** Read out (and shown before iOS 26) instead of "Cancel", e.g. "Close" when nothing is lost. */
  cancelLabel?: string;
  /** Back (‹) on the left instead of Cancel, for a later step inside the modal. */
  onBack?: () => void;
  /** The confirm action on the right, filled with the tint. Its icon defaults to a checkmark. */
  confirm?: {
    label: string;
    icon?: IconName;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
}

/**
 * The header of a modal form (add expense, new group, edit profile, settle up…): Cancel on the left
 * and the confirm action on the right, like Calendar's new event on iOS and a Material full-screen
 * dialog on Android.
 */
export const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onCancel,
  cancelLabel,
  onBack,
  confirm,
}) => {
  const { t } = useTranslation();
  const left: HeaderAction | undefined = onBack
    ? { label: t('common.back'), icon: icons.chevronLeft, onPress: onBack }
    : onCancel
      ? {
          label: cancelLabel ?? t('common.cancel'),
          icon: cancelHasIcon ? icons.close : undefined,
          onPress: onCancel,
        }
      : undefined;

  return (
    <>
      {undefined !== title ? <Stack.Screen options={{ title }} /> : null}
      {left ? <HeaderActions placement="left" actions={[left]} /> : null}
      {confirm ? (
        <HeaderActions
          actions={[
            {
              ...confirm,
              icon: confirmHasIcon ? (confirm.icon ?? icons.check) : undefined,
              variant: 'prominent',
            },
          ]}
        />
      ) : null}
    </>
  );
};
