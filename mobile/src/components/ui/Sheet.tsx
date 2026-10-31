import { BottomSheet } from '@expo/ui/community/bottom-sheet';
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme/tokens';

import { Text } from './Text';
import { Toaster } from './Toast';

const SNAP_POINTS = {
  /** Half height, can be pulled to full height. */
  medium: ['50%', '100%'],
  /** Full height. */
  large: ['100%'],
} as const;

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Called once the sheet has finished closing. */
  onDismiss?: () => void;
  /**
   * `fit` (default) sizes the sheet to its content. Use `medium` or `large` for long, scrolling
   * content (a list with a search field), and give the list `flex: 1` and a bottom content inset
   * of `useSafeAreaInsets().bottom`, so it scrolls to the sheet's bottom edge.
   */
  size?: 'fit' | keyof typeof SNAP_POINTS;
  /** Horizontal padding for the content. Defaults to true; turn off for edge-to-edge lists. */
  padded?: boolean;
  children: React.ReactNode;
}

/**
 * A native sheet (SwiftUI sheet with a grabber on iOS, Material 3 modal bottom sheet on Android)
 * for quick, in-screen tasks: pick a currency, edit a name. For a flow with its own URL, add a
 * route with `presentation: 'formSheet'` in app/(app)/_layout.tsx instead (see settle-up).
 */
export const Sheet: React.FC<SheetProps> = ({
  visible,
  onClose,
  title,
  onDismiss,
  size = 'fit',
  padded = true,
  children,
}) => {
  const insets = useSafeAreaInsets();
  // Keep the content mounted while the sheet animates out, and unmount it once it's gone.
  const [mounted, setMounted] = useState(visible);

  if (visible && !mounted) {
    setMounted(true);
  }

  const snapPoints = 'fit' === size ? undefined : [...SNAP_POINTS[size]];

  return (
    <BottomSheet
      index={visible ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={() => {
        setMounted(false);
        if (visible) {
          onClose();
        }
        onDismiss?.();
      }}
    >
      {mounted ? (
        <View
          style={[
            'fit' === size ? null : styles.fill,
            padded ? styles.padded : null,
            'fit' === size ? { paddingBottom: insets.bottom + spacing[4] } : null,
          ]}
        >
          {title ? (
            <Text variant="headline" align="center" style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {children}
          {/* The sheet is its own window on Android, above the app's toaster. iOS shows toasts
              above sheets already. */}
          {'android' === Platform.OS ? <Toaster /> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing[4],
  },
  title: {
    marginBottom: spacing[4],
  },
});
