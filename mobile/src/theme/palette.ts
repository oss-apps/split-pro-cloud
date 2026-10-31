/**
 * Raw brand colors behind the `tint`, `tintFill` and `onTint` roles in `tokens.ts`. Kept free of
 * React Native imports so `palette.test.ts` can check their contrast.
 *
 * The tint is two colors because iOS draws white on prominent bar buttons (the header "+", a modal's
 * ✓) whatever we ask: white needs a fill no lighter than cyan-700 for 4.5:1, which is too dark to
 * read as link text on black. So in dark mode text and icons use the bright cyan, and anything
 * filled behind `onTint` uses the deeper one.
 */
export const BRAND = {
  /** cyan-700: 5.4:1 on white, 4.8:1 on the grouped gray, and as a fill behind white. */
  light: '#0e7490',
  /** The web's cyan-500: 8.6:1 on black, 5.7:1 on the darkest cell gray. */
  dark: '#06b6d4',
  highContrastLight: '#155e75',
  highContrastDark: '#67e8f9',
};

/** Fills behind `onTint` (white): filled buttons, prominent header buttons, the selected day. */
export const BRAND_FILL = {
  light: '#0e7490',
  dark: '#0e7490',
  highContrastLight: '#155e75',
  highContrastDark: '#155e75',
};

/** Tint text on a tint wash (tinted buttons): the wash lowers contrast, so light mode goes deeper. */
export const BRAND_STRONG = {
  light: '#155e75',
  dark: '#06b6d4',
  highContrastLight: '#164e63',
  highContrastDark: '#67e8f9',
};

/** Opacity of the tint wash behind a tinted button's label. */
export const TINT_WASH_OPACITY = 0.12;

export const ON_TINT = '#ffffff';

/** Material 3 tonal palette for the brand (primary / on-primary), from the cyan seed. */
export const ANDROID_BRAND = {
  light: { tint: '#00687a', onTint: '#ffffff' },
  dark: { tint: '#4dd0e1', onTint: '#00363f' },
};

/** Apple's accessible variants of systemGreen / systemOrange, readable as text on white. */
export const POSITIVE = { light: '#248a3d', dark: '#30d158' };
export const NEGATIVE = { light: '#c93400', dark: '#ff9f0a' };

/** The iOS system backgrounds text sits on, for contrast checks (plain, grouped, cells). */
export const IOS_BACKGROUNDS = {
  light: ['#ffffff', '#f2f2f7', '#ffffff'],
  dark: ['#000000', '#1c1c1e', '#2c2c2e'],
};

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

const luminance = (hex: string) => {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/** `color` at `alpha` over `background`, like a tinted button's 15% fill. */
export const blend = (color: string, background: string, alpha: number) => {
  const top = toRgb(color);
  const bottom = toRgb(background);
  return `#${top
    .map((c, i) => Math.round(c * alpha + (bottom[i] ?? 0) * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
};

/** WCAG 2 contrast ratio between two opaque hex colors. */
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
