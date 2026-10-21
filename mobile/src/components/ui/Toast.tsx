import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React, { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { create } from 'zustand';

import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme/tokens';

import { Icon, icons } from './Icon';
import { Text } from './Text';

type ToastType = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

const useToastStore = create<{ current: ToastMessage | null }>()(() => ({ current: null }));

let nextId = 0;
const show = (type: ToastType, message: string) => {
  nextId += 1;
  useToastStore.setState({ current: { id: nextId, type, message } });
};

/**
 * Shows a short message at the top of the screen, above modals and sheets. `success` and `error`
 * also play the matching haptic, so don't add another.
 */
export const toast = {
  success: (message: string) => {
    haptics.success();
    show('success', message);
  },
  error: (message: string) => {
    haptics.error();
    show('error', message);
  },
  info: (message: string) => show('info', message),
  dismiss: () => useToastStore.setState({ current: null }),
};

const ICONS = { success: icons.success, error: icons.error, info: icons.info } as const;
const ICON_COLORS = {
  success: colors.positive,
  error: colors.destructive,
  info: colors.tint,
} as const;
const DURATION_MS = 3500;
const useGlass = isLiquidGlassAvailable();

/**
 * iOS presents modals above the app's root view. A full window overlay mounted when the toast
 * shows goes above them, and lets touches through around the toast.
 */
const Overlay = 'ios' === Platform.OS ? FullWindowOverlay : React.Fragment;

/** Render once at the root of the app. `Sheet` renders its own on Android. */
export const Toaster: React.FC = () => {
  const current = useToastStore((state) => state.current);
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!current) {
      return;
    }

    progress.setValue(0);
    Animated.spring(progress, { toValue: 1, useNativeDriver: true }).start();

    const timeout = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
        useToastStore.setState((state) =>
          state.current?.id === current.id ? { current: null } : state,
        ),
      );
    }, DURATION_MS);

    return () => clearTimeout(timeout);
  }, [current, progress]);

  if (!current) {
    return null;
  }

  const content = (
    <>
      <Icon name={ICONS[current.type]} size={20} color={ICON_COLORS[current.type]} />
      <Text variant="subheadline" weight="semibold" style={styles.message}>
        {current.message}
      </Text>
    </>
  );

  return (
    <Overlay>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.container,
          {
            top: insets.top + spacing[1],
            left: insets.left + spacing[4],
            right: insets.right + spacing[4],
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            ],
          },
        ]}
      >
        <Pressable onPress={toast.dismiss} accessibilityRole="alert">
          {useGlass ? (
            <GlassView glassEffectStyle="regular" isInteractive style={styles.toast}>
              {content}
            </GlassView>
          ) : (
            <View style={[styles.toast, styles.solid]}>{content}</View>
          )}
        </Pressable>
      </Animated.View>
    </Overlay>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 1000,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    maxWidth: 480,
    minHeight: 48,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[5],
    borderRadius: 9999,
  },
  solid: {
    backgroundColor: colors.secondaryGroupedBackground,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  message: {
    flexShrink: 1,
  },
});
