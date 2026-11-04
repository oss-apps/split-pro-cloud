import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, type TextInputInstance, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

import { Text } from './Text';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  length: number;
  /** Characters to keep; everything else is dropped as the user types. */
  allowed?: RegExp;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  error?: boolean;
}

/** One-time code entry: one box per character over a hidden input, so paste and autofill work. */
export const CodeInput: React.FC<CodeInputProps> = ({
  value,
  onChange,
  length,
  allowed = /[A-Z0-9]/,
  onComplete,
  autoFocus,
  error,
}) => {
  const inputRef = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);

  const handleChange = (text: string) => {
    const next = [...text.toUpperCase()]
      .filter((char) => allowed.test(char))
      .join('')
      .slice(0, length);

    onChange(next);

    if (length === next.length) {
      onComplete?.(next);
    }
  };

  return (
    <Pressable style={styles.row} onPress={() => inputRef.current?.focus()}>
      {Array.from({ length }, (_, index) => {
        const isActive =
          focused && (index === value.length || (length === value.length && index === length - 1));

        return (
          <View
            key={index}
            style={[styles.cell, isActive ? styles.active : null, error ? styles.invalid : null]}
          >
            <Text variant="title2" weight="semibold" allowFontScaling={false}>
              {value[index] ?? ''}
            </Text>
          </View>
        );
      })}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        maxLength={length}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.hiddenInput}
        accessibilityLabel="Code"
      />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[2],
  },
  cell: {
    width: 46,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.tertiaryFill,
  },
  active: {
    borderColor: colors.tint,
  },
  invalid: {
    borderColor: colors.destructive,
  },
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    opacity: 0.01,
    color: 'transparent',
  },
});
