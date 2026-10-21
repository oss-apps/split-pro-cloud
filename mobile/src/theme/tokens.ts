import { Color } from 'expo-router';
import {
  Appearance,
  type ColorValue,
  DynamicColorIOS,
  Platform,
  type TextStyle,
} from 'react-native';

import {
  ANDROID_BRAND,
  BRAND,
  BRAND_FILL,
  BRAND_STRONG,
  NEGATIVE,
  ON_TINT,
  POSITIVE,
} from './palette';

/**
 * Semantic colors. On iOS they are system colors (`PlatformColor`), so they follow light/dark mode
 * and Increased Contrast by themselves. On Android they are Material 3 dynamic colors (from the
 * wallpaper) for surfaces and text, resolved for the scheme the app launched in. Brand cyan is only
 * the tint (buttons, links, selection, tab bar).
 *
 * Never use raw hex values in screens: pick the role (`label`, `secondaryLabel`, `separator`, …).
 */
type ColorRole =
  /** Plain lists and full-screen content. */
  | 'background'
  /** Tiles and cards on a plain `background`. */
  | 'secondaryBackground'
  /** Behind inset-grouped sections (forms, settings, detail screens). */
  | 'groupedBackground'
  /** Cells inside an inset-grouped section, cards. */
  | 'secondaryGroupedBackground'
  /** Something inside a grouped cell (e.g. a field on a card). */
  | 'tertiaryGroupedBackground'
  /** Primary text. */
  | 'label'
  /** Subtitles, captions, values in rows. */
  | 'secondaryLabel'
  /** Disabled text, chevrons, timestamps of low importance. */
  | 'tertiaryLabel'
  | 'placeholder'
  /** Hairlines between rows. */
  | 'separator'
  /** Thin fills behind controls: search fields, gray buttons, skeletons. */
  | 'fill'
  | 'secondaryFill'
  | 'tertiaryFill'
  /** Row highlight while pressed (iOS). */
  | 'highlight'
  /** Brand accent for text and icons: links, plain buttons, selection, active tab. */
  | 'tint'
  /** Brand accent behind `onTint`: filled buttons, prominent header buttons, the FAB. */
  | 'tintFill'
  /** Tint text on a tint wash (tinted buttons). */
  | 'tintStrong'
  /** Text and icons on `tintFill`. */
  | 'onTint'
  /** Money you get back. */
  | 'positive'
  /** Money you owe. */
  | 'negative'
  /** Delete, errors. */
  | 'destructive'
  /** Dims content behind custom overlays. */
  | 'overlay'
  /** Fixed colors for things that never change with the scheme (e.g. text on avatar colors). */
  | 'white'
  | 'black';

export type ColorName = ColorRole;
export type Colors = Record<ColorRole, ColorValue>;

const iosColors = (): Colors => ({
  background: Color.ios.systemBackground,
  secondaryBackground: Color.ios.secondarySystemBackground,
  groupedBackground: Color.ios.systemGroupedBackground,
  secondaryGroupedBackground: Color.ios.secondarySystemGroupedBackground,
  tertiaryGroupedBackground: Color.ios.tertiarySystemGroupedBackground,
  label: Color.ios.label,
  secondaryLabel: Color.ios.secondaryLabel,
  tertiaryLabel: Color.ios.tertiaryLabel,
  placeholder: Color.ios.placeholderText,
  separator: Color.ios.separator,
  fill: Color.ios.systemFill,
  secondaryFill: Color.ios.secondarySystemFill,
  tertiaryFill: Color.ios.tertiarySystemFill,
  highlight: Color.ios.systemGray4,
  tint: DynamicColorIOS(BRAND),
  tintFill: DynamicColorIOS(BRAND_FILL),
  tintStrong: DynamicColorIOS(BRAND_STRONG),
  onTint: ON_TINT,
  positive: DynamicColorIOS(POSITIVE),
  negative: DynamicColorIOS(NEGATIVE),
  destructive: Color.ios.systemRed,
  overlay: 'rgba(0, 0, 0, 0.4)',
  white: '#ffffff',
  black: '#000000',
});

const androidColors = (dark: boolean): Colors => {
  const m3 = Color.android.dynamic;

  return {
    background: m3.surface,
    secondaryBackground: m3.surfaceContainer,
    groupedBackground: m3.surface,
    secondaryGroupedBackground: m3.surfaceContainer,
    tertiaryGroupedBackground: m3.surfaceContainerHigh,
    label: m3.onSurface,
    secondaryLabel: m3.onSurfaceVariant,
    tertiaryLabel: m3.outline,
    placeholder: m3.onSurfaceVariant,
    separator: m3.outlineVariant,
    fill: m3.surfaceContainerHighest,
    secondaryFill: m3.surfaceContainerHigh,
    tertiaryFill: m3.surfaceContainerHigh,
    highlight: m3.surfaceContainerHighest,
    // Material's primary / on-primary: one color for text and fills, its pair on top.
    tint: ANDROID_BRAND[dark ? 'dark' : 'light'].tint,
    tintFill: ANDROID_BRAND[dark ? 'dark' : 'light'].tint,
    tintStrong: ANDROID_BRAND[dark ? 'dark' : 'light'].tint,
    onTint: ANDROID_BRAND[dark ? 'dark' : 'light'].onTint,
    positive: dark ? '#6dd58c' : '#1b6d3a',
    negative: dark ? '#ffb68b' : '#9a4600',
    destructive: m3.error,
    overlay: 'rgba(0, 0, 0, 0.4)',
    white: '#ffffff',
    black: '#000000',
  };
};

/** Web (and tests): plain light/dark values close to the iOS system colors. */
const webColors = (dark: boolean): Colors => ({
  background: dark ? '#000000' : '#ffffff',
  secondaryBackground: dark ? '#1c1c1e' : '#f2f2f7',
  groupedBackground: dark ? '#000000' : '#f2f2f7',
  secondaryGroupedBackground: dark ? '#1c1c1e' : '#ffffff',
  tertiaryGroupedBackground: dark ? '#2c2c2e' : '#f2f2f7',
  label: dark ? '#ffffff' : '#000000',
  secondaryLabel: dark ? 'rgba(235, 235, 245, 0.6)' : 'rgba(60, 60, 67, 0.6)',
  tertiaryLabel: dark ? 'rgba(235, 235, 245, 0.3)' : 'rgba(60, 60, 67, 0.3)',
  placeholder: dark ? 'rgba(235, 235, 245, 0.3)' : 'rgba(60, 60, 67, 0.3)',
  separator: dark ? 'rgba(84, 84, 88, 0.6)' : 'rgba(60, 60, 67, 0.29)',
  fill: dark ? 'rgba(120, 120, 128, 0.36)' : 'rgba(120, 120, 128, 0.2)',
  secondaryFill: dark ? 'rgba(120, 120, 128, 0.32)' : 'rgba(120, 120, 128, 0.16)',
  tertiaryFill: dark ? 'rgba(118, 118, 128, 0.24)' : 'rgba(118, 118, 128, 0.12)',
  highlight: dark ? '#3a3a3c' : '#d1d1d6',
  tint: dark ? BRAND.dark : BRAND.light,
  tintFill: dark ? BRAND_FILL.dark : BRAND_FILL.light,
  tintStrong: dark ? BRAND_STRONG.dark : BRAND_STRONG.light,
  onTint: ON_TINT,
  positive: dark ? POSITIVE.dark : POSITIVE.light,
  negative: dark ? NEGATIVE.dark : NEGATIVE.light,
  destructive: dark ? '#ff453a' : '#ff3b30',
  overlay: 'rgba(0, 0, 0, 0.4)',
  white: '#ffffff',
  black: '#000000',
});

const isDark = 'dark' === Appearance.getColorScheme();

/**
 * iOS colors update live. Android and web resolve for the scheme at launch: Android keeps the
 * activity across a dark-mode switch, so styles made with StyleSheet.create keep their colors
 * until the next launch.
 */
export const colors: Colors = Platform.select({
  // Functions, so only this platform's colors are built: DynamicColorIOS throws off iOS.
  ios: () => iosColors(),
  android: () => androidColors(isDark),
  default: () => webColors(isDark),
})();

/** The system colors Settings uses behind its row icons (`SettingsIcon`). */
export type TileColor =
  'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'gray' | 'black';

/** iOS system colors (live on iOS, their light-mode values elsewhere). */
export const tileColors: Record<TileColor, ColorValue> = Platform.select({
  ios: () => ({
    red: Color.ios.systemRed,
    orange: Color.ios.systemOrange,
    yellow: Color.ios.systemYellow,
    green: Color.ios.systemGreen,
    teal: Color.ios.systemTeal,
    blue: Color.ios.systemBlue,
    indigo: Color.ios.systemIndigo,
    purple: Color.ios.systemPurple,
    gray: Color.ios.systemGray,
    black: '#000000',
  }),
  default: () => ({
    red: '#ff3b30',
    orange: '#ff9500',
    yellow: '#ffcc00',
    green: '#34c759',
    teal: '#30b0c7',
    blue: '#007aff',
    indigo: '#5856d6',
    purple: '#af52de',
    gray: '#8e8e93',
    black: '#000000',
  }),
})();

/** Background colors for avatars without an image, from the web's boring-avatars palette. */
export const avatarColors = ['#80C7B7', '#D9C27E', '#F4B088', '#FFA5AA', '#9D9DD3'] as const;
/** Initials on `avatarColors`, which are light in both schemes. */
export const avatarInitialsColor = '#1f2937';

/** 4pt spacing scale: `spacing[4]` is 16, the standard margin. */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

const iosVersion = 'ios' === Platform.OS ? parseInt(String(Platform.Version), 10) : 0;
/** iOS 26+ (Liquid Glass) uses rounder corners for grouped sections and controls. */
export const isLiquidGlassEra = 26 <= iosVersion;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  /** Inset-grouped sections and cards. */
  section: Platform.select({ ios: isLiquidGlassEra ? 26 : 10, default: 16 }),
  full: 9999,
} as const;

/** Layout constants shared by rows and sections. */
export const layout = {
  /** Space between the screen edge and an inset-grouped section. */
  sectionMargin: spacing[4],
  /** Leading/trailing padding inside rows. */
  rowPadding: spacing[4],
  /** Minimum row height: 44pt on iOS, 56dp on Android. */
  rowMinHeight: Platform.select({ ios: 44, default: 56 }),
  /** Standard avatar size in list rows. */
  rowAvatar: 40,
} as const;

/** System font weights. There are no custom fonts: SF Pro on iOS, Roboto on Android. */
export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

type TypeStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing'>;

const style = (ios: TypeStyle, android: TypeStyle): TypeStyle =>
  Platform.select({ ios, android, default: ios });

/**
 * The iOS text styles (Apple HIG, default Dynamic Type size), mapped to the closest Material 3 type
 * roles on Android. `Text` scales them with Dynamic Type through `dynamicTypeRamp`.
 */
export const typography = {
  largeTitle: style(
    { fontSize: 34, lineHeight: 41, fontWeight: '700' },
    { fontSize: 32, lineHeight: 40 },
  ),
  title1: style(
    { fontSize: 28, lineHeight: 34, fontWeight: '700' },
    { fontSize: 28, lineHeight: 36 },
  ),
  title2: style(
    { fontSize: 22, lineHeight: 28, fontWeight: '700' },
    { fontSize: 24, lineHeight: 32 },
  ),
  title3: style(
    { fontSize: 20, lineHeight: 25, fontWeight: '600' },
    { fontSize: 22, lineHeight: 28 },
  ),
  headline: style(
    { fontSize: 17, lineHeight: 22, fontWeight: '600' },
    { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0.15 },
  ),
  body: style(
    { fontSize: 17, lineHeight: 22 },
    { fontSize: 16, lineHeight: 24, letterSpacing: 0.5 },
  ),
  callout: style({ fontSize: 16, lineHeight: 21 }, { fontSize: 16, lineHeight: 24 }),
  subheadline: style(
    { fontSize: 15, lineHeight: 20 },
    { fontSize: 14, lineHeight: 20, letterSpacing: 0.25 },
  ),
  footnote: style({ fontSize: 13, lineHeight: 18 }, { fontSize: 12, lineHeight: 16 }),
  caption1: style(
    { fontSize: 12, lineHeight: 16 },
    { fontSize: 12, lineHeight: 16, letterSpacing: 0.4 },
  ),
  caption2: style(
    { fontSize: 11, lineHeight: 13 },
    { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 },
  ),
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

/** The Dynamic Type ramp for each variant (iOS scales each text style by its own curve). */
export const dynamicTypeRamps = {
  largeTitle: 'largeTitle',
  title1: 'title1',
  title2: 'title2',
  title3: 'title3',
  headline: 'headline',
  body: 'body',
  callout: 'callout',
  subheadline: 'subheadline',
  footnote: 'footnote',
  caption1: 'caption1',
  caption2: 'caption2',
} as const satisfies Record<TypographyVariant, string>;

/** Default text color per variant: small print is secondary, the rest is `label`. */
export const variantColors: Record<TypographyVariant, ColorName> = {
  largeTitle: 'label',
  title1: 'label',
  title2: 'label',
  title3: 'label',
  headline: 'label',
  body: 'label',
  callout: 'label',
  subheadline: 'label',
  footnote: 'secondaryLabel',
  caption1: 'secondaryLabel',
  caption2: 'secondaryLabel',
};

export const theme = { colors, spacing, radii, layout, fontWeights, typography } as const;
