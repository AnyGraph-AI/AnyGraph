/**
 * [AUD-TC-10-L1-09] colors.ts — Continuous HSL gradient color functions
 *
 * Spec: plans/codegraph/UI_DASHBOARD.md §Color Scales + §UI-V1
 * Source: ui/src/lib/colors.ts (123 lines)
 *
 * All exports are pure functions with no DOM dependency — ideal for node-env testing.
 * Tests verify: gradient continuity, boundary values, clamping behavior, return types.
 */

import { describe, it, expect } from 'vitest';
import {
  confidenceColor,
  painColor,
  gapColor,
  fragilityColor,
  confidenceTextClass,
  painTextClass,
  painOpacity,
  confidenceBorderColor,
} from '../lib/colors';

/**
 * Helper to extract hue from HSL string like "hsl(145, 85%, 48%)"
 */
function extractHue(hsl: string): number {
  const match = hsl.match(/hsl\((\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Invalid HSL string: ${hsl}`);
  return parseFloat(match[1]);
}

describe('[AUD-TC-10-L1-09] colors.ts — continuous HSL gradient functions', () => {
  describe('confidenceColor', () => {
    it('returns red hue (~0°) at confidence=0', () => {
      const color = confidenceColor(0);
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(0, 0); // red hue
    });

    it('returns amber hue (~38°) at confidence=0.5', () => {
      const color = confidenceColor(0.5);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(38, 0); // amber hue
    });

    it('returns green hue (~145°) at confidence=1.0', () => {
      const color = confidenceColor(1);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(145, 0); // green hue
    });

    it('produces smooth gradient — no sudden jumps near 0.5 boundary', () => {
      const hue049 = extractHue(confidenceColor(0.49));
      const hue050 = extractHue(confidenceColor(0.50));
      const hue051 = extractHue(confidenceColor(0.51));
      // Gradient should be continuous — adjacent values within ~5° of each other
      expect(Math.abs(hue050 - hue049)).toBeLessThan(5);
      expect(Math.abs(hue051 - hue050)).toBeLessThan(5);
    });

    it('clamps values below 0 to confidence=0', () => {
      const colorNeg = confidenceColor(-0.5);
      const color0 = confidenceColor(0);
      expect(colorNeg).toBe(color0);
    });

    it('clamps values above 1 to confidence=1', () => {
      const color15 = confidenceColor(1.5);
      const color1 = confidenceColor(1);
      expect(color15).toBe(color1);
    });
  });

  describe('painColor', () => {
    it('returns green hue (~145°) at pain=0', () => {
      const color = painColor(0);
      expect(color).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(145, 0); // green hue
    });

    it('returns amber hue (~38°) at pain=0.5', () => {
      const color = painColor(0.5);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(38, 0); // amber hue
    });

    it('returns red hue (~0°) at pain=1.0', () => {
      const color = painColor(1);
      const hue = extractHue(color);
      expect(hue).toBeCloseTo(0, 0); // red hue
    });

    it('is the inverse of confidenceColor — pain=0 matches confidence=1', () => {
      const painZero = extractHue(painColor(0));
      const confOne = extractHue(confidenceColor(1));
      expect(painZero).toBeCloseTo(confOne, 0);
    });

    it('clamps negative values', () => {
      expect(painColor(-1)).toBe(painColor(0));
    });

    it('clamps values above 1', () => {
      expect(painColor(2)).toBe(painColor(1));
    });
  });

  describe('gapColor', () => {
    it('follows same scale as painColor — delegates to painColor', () => {
      expect(gapColor(0)).toBe(painColor(0));
      expect(gapColor(0.5)).toBe(painColor(0.5));
      expect(gapColor(1)).toBe(painColor(1));
    });

    it('returns green at gap=0 (no gap) and red at gap=1 (severe gap)', () => {
      const greenHue = extractHue(gapColor(0));
      const redHue = extractHue(gapColor(1));
      expect(greenHue).toBeCloseTo(145, 0);
      expect(redHue).toBeCloseTo(0, 0);
    });
  });

  describe('fragilityColor', () => {
    it('follows same scale as painColor — delegates to painColor', () => {
      expect(fragilityColor(0)).toBe(painColor(0));
      expect(fragilityColor(0.25)).toBe(painColor(0.25));
      expect(fragilityColor(0.75)).toBe(painColor(0.75));
      expect(fragilityColor(1)).toBe(painColor(1));
    });
  });

  describe('confidenceTextClass', () => {
    it('returns text-red-400 for confidence < 0.25', () => {
      expect(confidenceTextClass(0)).toBe('text-red-400');
      expect(confidenceTextClass(0.1)).toBe('text-red-400');
      expect(confidenceTextClass(0.24)).toBe('text-red-400');
    });

    it('returns text-orange-400 for confidence in [0.25, 0.5)', () => {
      expect(confidenceTextClass(0.25)).toBe('text-orange-400');
      expect(confidenceTextClass(0.35)).toBe('text-orange-400');
      expect(confidenceTextClass(0.49)).toBe('text-orange-400');
    });

    it('returns text-amber-400 for confidence in [0.5, 0.75)', () => {
      expect(confidenceTextClass(0.5)).toBe('text-amber-400');
      expect(confidenceTextClass(0.6)).toBe('text-amber-400');
      expect(confidenceTextClass(0.74)).toBe('text-amber-400');
    });

    it('returns text-emerald-400 for confidence >= 0.75', () => {
      expect(confidenceTextClass(0.75)).toBe('text-emerald-400');
      expect(confidenceTextClass(0.9)).toBe('text-emerald-400');
      expect(confidenceTextClass(1)).toBe('text-emerald-400');
    });

    it('clamps negative and overflow values', () => {
      expect(confidenceTextClass(-0.5)).toBe('text-red-400'); // clamps to 0
      expect(confidenceTextClass(1.5)).toBe('text-emerald-400'); // clamps to 1
    });
  });

  describe('painTextClass', () => {
    it('returns text-emerald-400 for pain < 0.25 (inverse of confidence)', () => {
      expect(painTextClass(0)).toBe('text-emerald-400');
      expect(painTextClass(0.1)).toBe('text-emerald-400');
      expect(painTextClass(0.24)).toBe('text-emerald-400');
    });

    it('returns text-amber-400 for pain in [0.25, 0.5)', () => {
      expect(painTextClass(0.25)).toBe('text-amber-400');
      expect(painTextClass(0.35)).toBe('text-amber-400');
      expect(painTextClass(0.49)).toBe('text-amber-400');
    });

    it('returns text-orange-400 for pain in [0.5, 0.75)', () => {
      expect(painTextClass(0.5)).toBe('text-orange-400');
      expect(painTextClass(0.6)).toBe('text-orange-400');
      expect(painTextClass(0.74)).toBe('text-orange-400');
    });

    it('returns text-red-400 for pain >= 0.75', () => {
      expect(painTextClass(0.75)).toBe('text-red-400');
      expect(painTextClass(0.9)).toBe('text-red-400');
      expect(painTextClass(1)).toBe('text-red-400');
    });

    it('clamps negative and overflow values', () => {
      expect(painTextClass(-1)).toBe('text-emerald-400'); // clamps to 0
      expect(painTextClass(2)).toBe('text-red-400'); // clamps to 1
    });
  });

  describe('painOpacity', () => {
    it('returns 0.25 minimum when pain=0', () => {
      expect(painOpacity(0, 100)).toBe(0.25);
    });

    it('returns 1.0 maximum when pain=maxPain', () => {
      expect(painOpacity(100, 100)).toBe(1.0);
    });

    it('returns 0.625 at midpoint (pain=50, maxPain=100)', () => {
      // 0.25 + 0.75 * 0.5 = 0.625
      expect(painOpacity(50, 100)).toBeCloseTo(0.625);
    });

    it('returns 0.25 when maxPain is 0 or negative (guard clause)', () => {
      expect(painOpacity(10, 0)).toBe(0.25);
      expect(painOpacity(10, -5)).toBe(0.25);
    });

    it('clamps ratio to 0-1 range (pain > maxPain)', () => {
      // pain=150, maxPain=100 → clamps ratio to 1.0 → returns 1.0
      expect(painOpacity(150, 100)).toBe(1.0);
    });

    it('handles negative pain by clamping to 0', () => {
      // pain=-50, maxPain=100 → clamps ratio to 0 → returns 0.25
      expect(painOpacity(-50, 100)).toBe(0.25);
    });

    it('scales proportionally within range', () => {
      const op25 = painOpacity(25, 100);
      const op75 = painOpacity(75, 100);
      // 0.25 + 0.75 * 0.25 = 0.4375
      // 0.25 + 0.75 * 0.75 = 0.8125
      expect(op25).toBeCloseTo(0.4375);
      expect(op75).toBeCloseTo(0.8125);
    });
  });

  describe('confidenceBorderColor', () => {
    it('returns HSL string matching confidenceColor gradient', () => {
      expect(confidenceBorderColor(0)).toBe(confidenceColor(0));
      expect(confidenceBorderColor(0.5)).toBe(confidenceColor(0.5));
      expect(confidenceBorderColor(1)).toBe(confidenceColor(1));
    });

    it('delegates directly to confidenceColor', () => {
      // Verify the function is a direct delegation
      for (const value of [0.1, 0.33, 0.67, 0.95]) {
        expect(confidenceBorderColor(value)).toBe(confidenceColor(value));
      }
    });
  });

  describe('internal lerp behavior (tested via exported functions)', () => {
    it('confidenceColor uses linear interpolation in each segment', () => {
      // First segment: 0→0.5 maps hue 0→38
      // At t=0.25, hue should be ~19
      const hue025 = extractHue(confidenceColor(0.25));
      expect(hue025).toBeCloseTo(19, 0);

      // Second segment: 0.5→1.0 maps hue 38→145
      // At t=0.75, raw hue = 38 + (145-38)*0.5 = 91.5 → Math.round = 92
      const hue075 = extractHue(confidenceColor(0.75));
      expect(hue075).toBe(92); // Rounded from 91.5
    });

    it('painColor uses linear interpolation (inverse direction)', () => {
      // At pain=0.25: hue = 145 - (145-38)*0.5 = 91.5 → Math.round = 92
      const hue025 = extractHue(painColor(0.25));
      expect(hue025).toBe(92); // Rounded from 91.5
    });
  });

  describe('edge cases and regression guards', () => {
    it('all color functions return valid HSL strings', () => {
      const hslPattern = /^hsl\(\d+, \d+%, \d+%\)$/;
      const values = [0, 0.25, 0.5, 0.75, 1];
      for (const v of values) {
        expect(confidenceColor(v)).toMatch(hslPattern);
        expect(painColor(v)).toMatch(hslPattern);
        expect(gapColor(v)).toMatch(hslPattern);
        expect(fragilityColor(v)).toMatch(hslPattern);
        expect(confidenceBorderColor(v)).toMatch(hslPattern);
      }
    });

    it('all text class functions return valid Tailwind class strings', () => {
      const validClasses = ['text-red-400', 'text-orange-400', 'text-amber-400', 'text-emerald-400'];
      const values = [0, 0.25, 0.5, 0.75, 1];
      for (const v of values) {
        expect(validClasses).toContain(confidenceTextClass(v));
        expect(validClasses).toContain(painTextClass(v));
      }
    });

    it('painOpacity always returns number in [0.25, 1.0] range', () => {
      const cases = [
        [0, 100],
        [50, 100],
        [100, 100],
        [-50, 100],
        [150, 100],
        [0, 0],
        [0, -10],
      ];
      for (const [pain, maxPain] of cases) {
        const opacity = painOpacity(pain, maxPain);
        expect(opacity).toBeGreaterThanOrEqual(0.25);
        expect(opacity).toBeLessThanOrEqual(1.0);
      }
    });
  });
});
