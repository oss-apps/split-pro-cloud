import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANDROID_BRAND,
  BRAND,
  BRAND_FILL,
  BRAND_STRONG,
  IOS_BACKGROUNDS,
  ON_TINT,
  TINT_WASH_OPACITY,
  blend,
  contrast,
} from './palette';

/** WCAG 2 AA for normal-size text. */
const AA = 4.5;

const MODES = [
  { mode: 'light', highContrast: 'highContrastLight' },
  { mode: 'dark', highContrast: 'highContrastDark' },
] as const;

const assertAA = (foreground: string, background: string, what: string) => {
  const ratio = contrast(foreground, background);
  assert.ok(AA <= ratio, `${what}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
};

describe('palette contrast', () => {
  describe('iOS', () => {
    MODES.forEach(({ mode, highContrast }) => {
      it(`should keep onTint readable on tintFill in ${mode} mode`, () => {
        assertAA(ON_TINT, BRAND_FILL[mode], 'filled button');
        assertAA(ON_TINT, BRAND_FILL[highContrast], 'filled button, high contrast');
      });

      it(`should keep tint text readable on every background in ${mode} mode`, () => {
        IOS_BACKGROUNDS[mode].forEach((background) => {
          assertAA(BRAND[mode], background, 'link');
          assertAA(BRAND[highContrast], background, 'link, high contrast');
        });
      });

      it(`should keep tinted button labels readable in ${mode} mode`, () => {
        IOS_BACKGROUNDS[mode].forEach((background) => {
          const wash = blend(BRAND[mode], background, TINT_WASH_OPACITY);
          assertAA(BRAND_STRONG[mode], wash, 'tinted button');
          assertAA(BRAND_STRONG[highContrast], wash, 'tinted button, high contrast');
        });
      });
    });
  });

  describe('Android', () => {
    MODES.forEach(({ mode }) => {
      const { tint, onTint } = ANDROID_BRAND[mode];
      // Material surfaces come from the wallpaper; these are the neutral extremes.
      const surfaces = 'light' === mode ? ['#ffffff', '#f3f3f3'] : ['#111318', '#1d2024'];

      it(`should keep onTint readable on the tint in ${mode} mode`, () => {
        assertAA(onTint, tint, 'filled button / FAB');
      });

      it(`should keep tint text and tinted buttons readable in ${mode} mode`, () => {
        surfaces.forEach((surface) => {
          assertAA(tint, surface, 'link');
          assertAA(tint, blend(tint, surface, TINT_WASH_OPACITY), 'tinted button');
        });
      });
    });
  });
});
