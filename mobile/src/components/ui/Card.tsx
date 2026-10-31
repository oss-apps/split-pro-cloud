import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

export interface CardProps extends ViewProps {
  /** Removes the inner padding, e.g. for a card holding `ListRow`s. */
  flush?: boolean;
}

/**
 * A rounded grouped surface without the section chrome. Prefer `Section` for rows; use `Card` for
 * free-form content (a summary, a chart) on a `groupedBackground` screen.
 */
export const Card: React.FC<CardProps> = ({ flush, style, ...props }) => (
  <View style={[styles.card, flush ? null : styles.padded, style]} {...props} />
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.secondaryGroupedBackground,
    borderRadius: radii.section,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  padded: {
    padding: spacing[4],
  },
});
