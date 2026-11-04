import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const run = (feedback: () => Promise<void>) => {
  if ('web' === Platform.OS) {
    return;
  }

  feedback().catch(console.warn);
};

/**
 * System haptics. `toast.success` / `toast.error` already play `success` / `error`, so only call
 * these for feedback without a toast (e.g. picking a segment, a swipe action, a long press).
 */
export const haptics = {
  /** Saved, settled, deleted. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Something needs attention, e.g. a confirmation for a destructive action. */
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Failed. */
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** A value changed: segmented control, picker, toggle. */
  selection: () => run(() => Haptics.selectionAsync()),
  /** A light tap, e.g. a long press opening a menu. */
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
