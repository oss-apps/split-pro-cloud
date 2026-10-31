import React from 'react';
import { ActivityIndicator, type ColorValue, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

/** The system activity indicator. Gray like UIKit's by default. */
export const Spinner: React.FC<{ color?: ColorValue; size?: 'small' | 'large' }> = ({
  color = colors.secondaryLabel,
  size = 'small',
}) => <ActivityIndicator color={color} size={size} />;

/** Centered spinner that fills its parent, for whole-screen loading states. */
export const FullScreenSpinner: React.FC<{ grouped?: boolean }> = ({ grouped }) => (
  <View
    style={[
      styles.fill,
      { backgroundColor: grouped ? colors.groupedBackground : colors.background },
    ]}
  >
    <Spinner size="large" />
  </View>
);

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
