import React from 'react';
import { Platform, StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme/tokens';

import { Icon, icons } from './Icon';

/**
 * A search field for lists inside sheets, where there is no navigation header. On a screen with a
 * header, use the header's search bar instead (`headerSearchBarOptions` or `Stack.SearchBar`).
 */
export const SearchField: React.FC<Omit<TextInputProps, 'style'>> = (props) => (
  <View style={styles.field}>
    <Icon name={icons.search} size={17} color={colors.secondaryLabel} />
    <TextInput
      placeholderTextColor={colors.placeholder}
      selectionColor={colors.tint}
      cursorColor={colors.tint}
      clearButtonMode="while-editing"
      autoCorrect={false}
      returnKeyType="search"
      enterKeyHint="search"
      style={styles.input}
      {...props}
    />
  </View>
);

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: Platform.select({ ios: 36, default: 56 }),
    paddingHorizontal: spacing[2],
    borderRadius: Platform.select({ ios: radii.md, default: radii.full }),
    borderCurve: 'continuous',
    backgroundColor: colors.tertiaryFill,
  },
  input: {
    ...typography.body,
    lineHeight: undefined,
    flex: 1,
    color: colors.label,
    paddingVertical: spacing[1],
  },
});
