import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * A native confirm dialog, like the web's AlertDialog. React Native Web's `Alert` ignores buttons, so
 * the web build uses the browser's dialogs.
 */
export const confirmAction = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
}: ConfirmOptions) => {
  if ('web' === Platform.OS) {
    if (globalThis.confirm?.([title, message].filter(Boolean).join('\n\n'))) {
      onConfirm();
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
};

/** A dialog with only an OK button, e.g. to explain why an action isn't possible yet. */
export const showMessage = (title: string, message: string, okLabel: string) => {
  if ('web' === Platform.OS) {
    globalThis.alert?.([title, message].filter(Boolean).join('\n\n'));
    return;
  }

  Alert.alert(title, message, [{ text: okLabel }]);
};
