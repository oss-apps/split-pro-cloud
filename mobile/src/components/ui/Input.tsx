import React, { forwardRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputInstance,
  type TextInputProps,
  View,
} from 'react-native';

import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

import { Text } from './Text';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
  /**
   * A borderless field filling a row, for use inside a `Section` (like a Settings or Contacts
   * form). Without it the field stands alone: a filled rounded field on iOS, outlined on Android.
   */
  inline?: boolean;
}

export const Input = forwardRef<TextInputInstance, InputProps>(
  ({ label, error, hint, inline, style, onFocus, onBlur, ...props }, ref) => {
    const [focused, setFocused] = useState(false);

    return (
      <View style={inline ? null : styles.container}>
        {label ? (
          <Text variant="footnote" color="secondaryLabel" style={styles.label}>
            {label}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.tint}
          cursorColor={colors.tint}
          clearButtonMode="while-editing"
          style={[
            styles.input,
            inline ? styles.inline : styles.field,
            !inline && focused && 'ios' !== Platform.OS ? styles.focused : null,
            !inline && error ? styles.invalid : null,
            style,
          ]}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
        {error ? (
          <Text variant="footnote" color="destructive" style={styles.label}>
            {error}
          </Text>
        ) : hint ? (
          <Text variant="footnote" style={styles.label}>
            {hint}
          </Text>
        ) : null}
      </View>
    );
  },
);
Input.displayName = 'Input';

const styles = StyleSheet.create({
  container: {
    gap: spacing[1],
    alignSelf: 'stretch',
  },
  label: {
    paddingHorizontal: spacing[1],
  },
  input: {
    ...typography.body,
    // A line height offsets single-line text in iOS text fields.
    lineHeight: undefined,
    color: colors.label,
  },
  field: Platform.select({
    ios: {
      minHeight: 50,
      paddingHorizontal: spacing[4],
      borderRadius: radii.lg,
      borderCurve: 'continuous',
      backgroundColor: colors.tertiaryFill,
    },
    default: {
      minHeight: 56,
      paddingHorizontal: spacing[4],
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: colors.tertiaryLabel,
    },
  }),
  inline: {
    minHeight: layout.rowMinHeight,
    paddingHorizontal: layout.rowPadding,
  },
  focused: {
    borderWidth: 2,
    borderColor: colors.tint,
  },
  invalid: Platform.select({
    ios: { borderWidth: 1, borderColor: colors.destructive },
    default: { borderWidth: 2, borderColor: colors.destructive },
  }),
});
