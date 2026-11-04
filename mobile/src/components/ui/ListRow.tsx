import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { colors, layout, spacing } from '@/theme/tokens';

import { Icon, icons } from './Icon';
import { Text } from './Text';

export interface ListRowProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Leading content: an `Avatar`, or an `Icon` (29pt tile or plain). */
  left?: React.ReactNode;
  /** Trailing content, e.g. a `Money` amount, a `Switch`. */
  right?: React.ReactNode;
  /** Trailing value in secondary text, like Settings' "Version 1.0". Ignored when `right` is set. */
  detail?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /**
   * `chevron` for rows that push a screen (iOS only: Material lists don't use chevrons),
   * `checkmark` for the selected option in a list of choices.
   */
  accessory?: 'chevron' | 'checkmark';
  /** @deprecated Use `accessory="chevron"`. */
  showChevron?: boolean;
  /** Red title, for "Delete group" style rows. */
  destructive?: boolean;
  /** Tinted title, for action rows like "Add members". */
  action?: boolean;
  /** @deprecated Rows in a `Section` get separators; in a FlatList use `ItemSeparatorComponent`. */
  divider?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * A native list row (UITableViewCell / Material list item): leading content, title and subtitle,
 * trailing content and accessory. Highlights while pressed. Use it directly in a FlatList for plain
 * lists, or inside a `Section` for inset-grouped forms and settings.
 */
export const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  left,
  right,
  detail,
  onPress,
  onLongPress,
  accessory,
  showChevron,
  destructive,
  action,
  divider,
  disabled,
  accessibilityLabel,
}) => {
  const trailing = accessory ?? (showChevron ? 'chevron' : undefined);
  const titleColor = destructive ? 'destructive' : action ? 'tint' : 'label';
  const pressable = !!onPress || !!onLongPress;

  return (
    <Pressable
      disabled={!pressable || disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      // Without onPress, keep controls in `right` (e.g. a Switch) reachable by screen readers.
      accessible={pressable}
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: 'checkmark' === trailing }}
      android_ripple={pressable ? { color: colors.highlight } : undefined}
      style={({ pressed }) => [
        styles.row,
        pressed && 'ios' === Platform.OS ? { backgroundColor: colors.highlight } : null,
        divider ? styles.divider : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.body}>
        {'string' === typeof title ? (
          <Text color={titleColor} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {'string' === typeof subtitle ? (
          <Text variant="subheadline" color="secondaryLabel" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {right ??
        (detail ? (
          <Text color="secondaryLabel" numberOfLines={1} style={styles.detail}>
            {detail}
          </Text>
        ) : null)}
      {'chevron' === trailing && 'ios' === Platform.OS ? (
        <Icon name={icons.chevronRight} size={14} weight="semibold" color={colors.tertiaryLabel} />
      ) : null}
      {'checkmark' === trailing ? (
        <Icon name={icons.check} size={17} weight="semibold" color={colors.tint} />
      ) : null}
    </Pressable>
  );
};

/**
 * Hairline between rows, starting at the row's text like iOS. `inset` is the left offset: 16 for
 * text-only rows (default), `rowInset(avatarSize)` for rows with an avatar or icon.
 */
export const Separator: React.FC<{ inset?: number }> = ({ inset = layout.rowPadding }) => (
  <View style={[styles.separator, { marginLeft: inset }]} />
);

/** Separator inset for rows whose `left` is `size` wide. */
export const rowInset = (size: number) => layout.rowPadding + size + spacing[3];

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: layout.rowMinHeight,
    paddingVertical: Platform.select({ ios: 11, default: spacing[3] }),
    paddingHorizontal: layout.rowPadding,
  },
  left: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  detail: {
    flexShrink: 1,
    maxWidth: '60%',
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  disabled: {
    opacity: 0.4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
});
