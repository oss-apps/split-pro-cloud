import { MaterialSymbols_400Regular_Filled } from '@expo-google-fonts/material-symbols/400Regular_Filled';
import { loadAsync, renderToImageAsync } from 'expo-font';
import { NativeTabs, type NativeTabsTriggerIconProps } from 'expo-router/native-tabs';
import { type AndroidSymbol, unstable_getMaterialSymbolSourceAsync } from 'expo-symbols';
import React from 'react';

import { type IconName } from './Icon';

const FILLED_FONT = 'MaterialSymbols_400Regular_Filled';

/**
 * Code points of the selected tab icons. The filled font shares them with the outlined one, but
 * expo-symbols doesn't export its name table. Add a symbol here when a tab gets a selected icon.
 */
const FILLED_CODE_POINTS: Partial<Record<AndroidSymbol, number>> = {
  pie_chart: 0xe6c4,
  group: 0xe7ef,
  account_circle: 0xe853,
};

// White glyphs: the navigation bar tints every icon with its selected / unselected color.
const outlinedSymbols = {
  getImageSource: (name: AndroidSymbol, size: number) =>
    unstable_getMaterialSymbolSourceAsync(name, size, 'white'),
};

const filledSymbols = {
  getImageSource: async (name: AndroidSymbol, size: number) => {
    const codePoint = FILLED_CODE_POINTS[name];

    if (undefined === codePoint) {
      return outlinedSymbols.getImageSource(name, size);
    }

    await loadAsync({ [FILLED_FONT]: MaterialSymbols_400Regular_Filled });
    return renderToImageAsync(String.fromCodePoint(codePoint), {
      fontFamily: FILLED_FONT,
      size,
      color: 'white',
      lineHeight: size,
    });
  },
};

/**
 * Props for `NativeTabs.Trigger.Icon`. Material marks the selected destination with a filled icon,
 * like the `.fill` SF Symbol on iOS, but `md` only draws outlined symbols: so `selected` is drawn
 * from the filled Material Symbols font.
 */
export const tabIcon = (icon: IconName, selected?: IconName): NativeTabsTriggerIconProps => {
  const outlined = <NativeTabs.Trigger.VectorIcon family={outlinedSymbols} name={icon.android} />;

  return {
    sf: icon.ios,
    src: selected
      ? {
          default: outlined,
          selected: (
            <NativeTabs.Trigger.VectorIcon family={filledSymbols} name={selected.android} />
          ),
        }
      : outlined,
  };
};
