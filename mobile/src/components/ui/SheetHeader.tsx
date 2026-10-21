import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { Icon, type IconName, icons } from './Icon';
import { Text } from './Text';

const BUTTON_SIZE = 44;
const glass = 'ios' === Platform.OS && isLiquidGlassAvailable();

export interface SheetHeaderProps {
  title: string;
  /** The confirm action on the right ("Done"): a tinted ✓ on iOS 26, text elsewhere. */
  confirm?: { label: string; icon?: IconName; onPress: () => void; disabled?: boolean };
}

/**
 * The title row of a `Sheet` with an action, drawn to match `ModalHeader` (the navigation bar of
 * modal screens): a glass ✓ on iOS 26, a bold text button before it and on Android.
 */
export const SheetHeader: React.FC<SheetHeaderProps> = ({ title, confirm }) => {
  const disabled = !!confirm?.disabled;

  const button = !confirm ? null : glass ? (
    <Pressable
      onPress={confirm.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={confirm.label}
      accessibilityState={{ disabled }}
    >
      <GlassView
        isInteractive
        tintColor={disabled ? undefined : colors.tintFill}
        style={styles.glassButton}
      >
        <Icon
          name={confirm.icon ?? icons.check}
          size={20}
          weight="semibold"
          color={disabled ? colors.tertiaryLabel : colors.white}
        />
      </GlassView>
    </Pressable>
  ) : (
    <Pressable
      onPress={confirm.onPress}
      disabled={disabled}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text weight="semibold" color={disabled ? 'tertiaryLabel' : 'tint'} numberOfLines={1}>
        {confirm.label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.header}>
      <View style={styles.side} />
      <Text
        variant="headline"
        accessibilityRole="header"
        numberOfLines={1}
        align="center"
        style={styles.title}
      >
        {title}
      </Text>
      <View style={[styles.side, styles.end]}>{button}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BUTTON_SIZE,
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  side: {
    width: 72,
  },
  end: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
  },
  glassButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
