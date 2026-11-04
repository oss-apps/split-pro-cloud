import React from 'react';
import { type ColorValue, Platform, StyleSheet, View } from 'react-native';

import { type TileColor, colors, tileColors } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';

/** Width of the icon slot, for `rowInset(SETTINGS_ICON_SIZE)`. */
export const SETTINGS_ICON_SIZE = Platform.select({ ios: 30, default: 24 });

export interface SettingsIconProps {
  name?: IconName;
  color: TileColor;
  /** Custom content instead of a symbol, e.g. a brand logo. Gets white on iOS. */
  children?: (tint: ColorValue) => React.ReactNode;
}

/**
 * A row icon like Settings': a white symbol on a colored rounded square on iOS, a plain Material
 * symbol on Android (Material settings lists don't color their icons).
 */
export const SettingsIcon: React.FC<SettingsIconProps> = ({ name, color, children }) => {
  if ('ios' !== Platform.OS) {
    return (
      <View style={styles.plain}>
        {children
          ? children(colors.secondaryLabel)
          : name && <Icon name={name} size={24} color={colors.secondaryLabel} />}
      </View>
    );
  }

  return (
    <View style={[styles.tile, { backgroundColor: tileColors[color] }]}>
      {children
        ? children(colors.white)
        : name && <Icon name={name} size={17} weight="semibold" color={colors.white} />}
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: SETTINGS_ICON_SIZE,
    height: SETTINGS_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    borderCurve: 'continuous',
  },
  plain: {
    width: SETTINGS_ICON_SIZE,
    height: SETTINGS_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
