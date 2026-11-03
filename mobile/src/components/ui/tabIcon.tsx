import { type NativeTabsTriggerIconProps } from 'expo-router/native-tabs';

import { type IconName } from './Icon';

/**
 * Props for `NativeTabs.Trigger.Icon`: `icon` normally, `selected` (a filled symbol) on the selected
 * tab. Android draws `selected` in the filled Material Symbols style (`tabIcon.android.tsx`).
 */
export const tabIcon = (icon: IconName, selected?: IconName): NativeTabsTriggerIconProps => ({
  sf: selected ? { default: icon.ios, selected: selected.ios } : icon.ios,
  md: icon.android,
});
