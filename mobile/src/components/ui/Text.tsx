import React from 'react';
import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from 'react-native';

import {
  type ColorName,
  type TypographyVariant,
  colors,
  dynamicTypeRamps,
  fontWeights,
  typography,
  variantColors,
} from '@/theme/tokens';

export interface TextProps extends RNTextProps {
  /** An iOS text style (`body` by default). Scales with Dynamic Type. */
  variant?: TypographyVariant;
  /** Defaults to `label`, or `secondaryLabel` for footnote and captions. */
  color?: ColorName;
  weight?: keyof typeof fontWeights;
  align?: 'left' | 'center' | 'right';
  /** Fixed-width digits, for amounts that line up or change. */
  tabular?: boolean;
}

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color,
  weight,
  align,
  tabular,
  style,
  ...props
}) => (
  <RNText
    dynamicTypeRamp={dynamicTypeRamps[variant]}
    style={[
      typography[variant],
      { color: colors[color ?? variantColors[variant]] },
      weight ? { fontWeight: fontWeights[weight] } : null,
      align ? { textAlign: align } : null,
      tabular ? styles.tabular : null,
      StyleSheet.flatten(style),
    ]}
    {...props}
  />
);

const styles = StyleSheet.create({
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
