import React from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface FabProps {
  icon: IconName;
  label: string;
  onPress: () => void;
}

/**
 * Material 3 extended floating action button, bottom right. Android's place for a screen's primary
 * action; iOS puts that action in the navigation bar instead (see `AddExpenseAction`). Render it as
 * the last child of the screen's root view.
 */
export const Fab: React.FC<FabProps> = ({ icon, label, onPress }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    android_ripple={{ color: colors.highlight, foreground: true }}
    style={styles.fab}
  >
    <Icon name={icon} size={24} color={colors.onTint} />
    <Text variant="headline" style={{ color: colors.onTint }}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing[4],
    bottom: spacing[4],
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.tintFill,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
