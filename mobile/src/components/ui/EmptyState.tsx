import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  /** An `icons.*` entry. */
  icon?: IconName;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Like SwiftUI's ContentUnavailableView: a large symbol, a title, a line of help, an action. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <View style={styles.container}>
      {icon ? (
        <Icon name={icon} size={48} color={colors.secondaryLabel} style={styles.icon} />
      ) : null}
      <Text variant="title2" align="center">
        {title}
      </Text>
      {description ? (
        <Text variant="callout" color="secondaryLabel" align="center">
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} variant="tinted" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[12],
  },
  icon: {
    marginBottom: spacing[2],
  },
  action: {
    marginTop: spacing[3],
  },
});
