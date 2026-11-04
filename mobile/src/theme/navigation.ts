import { type NativeStackNavigationOptions } from 'expo-router';
import { type NativeTabsProps } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { colors, navigationBarColors } from './tokens';

/**
 * The tab bar. The tint marks the selected tab; on Android its indicator and ripple are in the
 * brand palette too (`navigationBarColors`), and Material labels every destination (iOS always
 * does). The bar itself keeps Material's surface container.
 */
export const tabBarOptions: Partial<NativeTabsProps> = {
  tintColor: colors.tint,
  ...Platform.select<Partial<NativeTabsProps>>({
    android: {
      indicatorColor: navigationBarColors.indicator,
      rippleColor: navigationBarColors.ripple,
      labelVisibilityMode: 'labeled',
    },
    default: {},
  }),
};

/**
 * Defaults for every native stack: system back button and tint. On iOS 26 headers are transparent
 * (Liquid Glass) by default, so scroll views need `contentInsetAdjustmentBehavior="automatic"`.
 */
export const stackScreenOptions: NativeStackNavigationOptions = {
  headerTintColor: colors.tint,
  // A chevron only, like iOS 26 system apps; the previous title is often a route group name.
  headerBackButtonDisplayMode: 'minimal',
  // The tint colors the bar buttons; titles stay the label color, like system apps.
  headerTitleStyle: { color: colors.label },
  headerLargeTitleStyle: { color: colors.label },
  contentStyle: { backgroundColor: colors.background },
};

/** A tab's root screen: a large title that collapses into the bar as the content scrolls. */
export const tabRootOptions: NativeStackNavigationOptions = {
  headerLargeTitleEnabled: true,
  headerLargeTitleShadowVisible: false,
};

/** Inset-grouped screens (forms, settings-style and detail screens): the grouped background. */
export const groupedScreenOptions: NativeStackNavigationOptions = {
  contentStyle: { backgroundColor: colors.groupedBackground },
};

/**
 * An opaque header without a hairline, for inset-grouped page-sheet modals whose content starts
 * with a large picture (edit profile): a transparent header there covers its top. It takes the
 * grouped background so it doesn't show as a white band above the content in light mode.
 */
export const opaqueHeaderOptions: NativeStackNavigationOptions = {
  headerTransparent: false,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: colors.groupedBackground },
};
