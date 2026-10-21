import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';

export interface QuickAction {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * A row of equal action tiles under a profile header, like the message / call / mail buttons on a
 * Contacts card. Two to four actions; the rest belong in the header's menu.
 */
export const QuickActions: React.FC<{ actions: QuickAction[] }> = ({ actions }) => (
  <View style={styles.row}>
    {actions.map((action) => (
      <Pressable
        key={action.label}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        accessibilityState={{ disabled: !!action.disabled, busy: !!action.loading }}
        disabled={action.disabled || action.loading}
        onPress={action.onPress}
        android_ripple={{ color: colors.highlight }}
        style={({ pressed }) => [
          styles.tile,
          pressed && 'ios' === Platform.OS ? { backgroundColor: colors.highlight } : null,
          action.disabled ? styles.disabled : null,
        ]}
      >
        <View style={styles.icon}>
          {action.loading ? <Spinner /> : <Icon name={action.icon} size={22} color={colors.tint} />}
        </View>
        <Text variant="caption1" weight="medium" color="tint" numberOfLines={1}>
          {action.label}
        </Text>
      </Pressable>
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: spacing[1],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    paddingHorizontal: spacing[1],
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.secondaryGroupedBackground,
  },
  icon: {
    height: 26,
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
});
