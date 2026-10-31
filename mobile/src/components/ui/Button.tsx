import React from 'react';
import {
  type ColorValue,
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { TINT_WASH_OPACITY } from '@/theme/palette';
import { colors, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';

/**
 * System button styles (UIKit's filled / tinted / gray / plain, Material's filled / tonal / text):
 * - `filled`: the one primary action on a screen.
 * - `tinted`: a secondary action next to a filled one.
 * - `gray`: a neutral secondary action.
 * - `plain`: text-only, e.g. "Resend code".
 * - `destructive`: delete or remove, red and tinted.
 */
const VARIANTS = {
  filled: { background: colors.tintFill, text: colors.onTint, tinted: false },
  tinted: { background: colors.tint, text: colors.tintStrong, tinted: true },
  gray: { background: colors.fill, text: colors.tint, tinted: false },
  plain: { background: undefined, text: colors.tint, tinted: false },
  destructive: { background: colors.destructive, text: colors.destructive, tinted: true },
} as const satisfies Record<
  string,
  { background: ColorValue | undefined; text: ColorValue; tinted: boolean }
>;

const SIZES = {
  small: { height: 34, paddingHorizontal: spacing[3], variant: 'subheadline', iconSize: 15 },
  medium: { height: 44, paddingHorizontal: spacing[4], variant: 'body', iconSize: 17 },
  large: { height: 52, paddingHorizontal: spacing[5], variant: 'body', iconSize: 19 },
  /** Square icon-only button; give it an `accessibilityLabel`. */
  icon: { height: 44, paddingHorizontal: 0, variant: 'body', iconSize: 20 },
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An `icons.*` entry. */
  icon?: IconName;
  /** Replaces the label with a spinner and disables the button. */
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  variant = 'filled',
  size = 'medium',
  icon,
  loading,
  disabled,
  fullWidth,
  style,
  children,
  ...props
}) => {
  const palette = VARIANTS[variant];
  const dimensions = SIZES[size];
  const isDisabled = !!disabled || !!loading;
  const textColor = palette.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      disabled={isDisabled}
      android_ripple={
        palette.background ? { color: colors.highlight, foreground: true } : undefined
      }
      style={({ pressed }) => [
        styles.base,
        { height: dimensions.height, paddingHorizontal: dimensions.paddingHorizontal },
        'icon' === size ? { width: dimensions.height } : null,
        fullWidth ? styles.fullWidth : null,
        pressed && 'ios' === Platform.OS ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...props}
    >
      {palette.background ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.background,
            { backgroundColor: palette.background },
            palette.tinted ? styles.tinted : null,
          ]}
        />
      ) : null}
      {loading ? (
        <Spinner color={textColor} />
      ) : (
        <View style={styles.content}>
          {icon ? (
            <Icon name={icon} size={dimensions.iconSize} color={textColor} weight="semibold" />
          ) : null}
          {title ? (
            <Text
              variant={dimensions.variant}
              weight="semibold"
              style={{ color: textColor }}
              numberOfLines={1}
            >
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    overflow: 'hidden',
  },
  background: {
    borderRadius: 9999,
  },
  tinted: {
    opacity: TINT_WASH_OPACITY,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.35,
  },
});
