/**
 * UI-V1: Continuous gradient color functions
 *
 * Replaces all threshold-based 4-bracket color functions with smooth
 * HSL interpolation. Every 0-1 input produces a unique color — no more
 * "90% of files land in the same bucket."
 *
 * Design spec (UI_DASHBOARD.md):
 * - Confidence: red (0) → amber (0.5) → green (1.0)
 * - Pain/Risk: green (0) → yellow (0.25) → orange (0.5) → red (1.0)
 * - Gap severity: green (0) → amber (0.5) → red (1.0)
 * - Fragility: same as pain scale
 */

/**
 * Linearly interpolate between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a value between 0 and 1.
 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Confidence gradient: red → amber → green (continuous HSL).
 *
 * HSL hue: 0° (red) at conf=0, 38° (amber) at conf=0.5, 145° (green) at conf=1.0
 * Saturation: 85% constant
 * Lightness: 45-50% (readable on dark backgrounds)
 *
 * Returns an HSL color string.
 */
export function confidenceColor(conf: number): string {
  const t = clamp01(conf);
  // Two-segment hue interpolation: red→amber→green
  const hue = t <= 0.5
    ? lerp(0, 38, t / 0.5)    // red (0°) → amber (38°)
    : lerp(38, 145, (t - 0.5) / 0.5); // amber (38°) → green (145°)
  const sat = 85;
  const light = lerp(45, 48, t); // slightly brighter at high confidence
  return `hsl(${Math.round(hue)}, ${sat}%, ${Math.round(light)}%)`;
}

/**
 * Pain/risk gradient: green → yellow → orange → red (continuous HSL).
 *
 * HSL hue: 145° (green) at pain=0, 38° (amber) at pain=0.5, 0° (red) at pain=1.0
 * Essentially the reverse of confidence.
 *
 * Returns an HSL color string.
 */
export function painColor(pain: number): string {
  const t = clamp01(pain);
  // Two-segment: green→amber→red
  const hue = t <= 0.5
    ? lerp(145, 38, t / 0.5)     // green (145°) → amber (38°)
    : lerp(38, 0, (t - 0.5) / 0.5); // amber (38°) → red (0°)
  const sat = 85;
  const light = lerp(48, 45, t); // slightly darker at high pain
  return `hsl(${Math.round(hue)}, ${sat}%, ${Math.round(light)}%)`;
}

/**
 * Gap severity gradient: same as pain scale.
 * 0 = no gap (green), 1 = severe gap (red).
 */
export function gapColor(gap: number): string {
  return painColor(gap);
}

/**
 * Fragility gradient: same as pain scale.
 * Normalized: pass fragility / maxFragility for 0-1 range.
 */
export function fragilityColor(fragility: number): string {
  return painColor(fragility);
}

/**
 * Confidence to Tailwind text class (for contexts where inline HSL isn't ideal).
 * Returns a Tailwind class name string.
 */
export function confidenceTextClass(conf: number): string {
  const t = clamp01(conf);
  if (t >= 0.75) return 'text-emerald-400';
  if (t >= 0.5) return 'text-amber-400';
  if (t >= 0.25) return 'text-orange-400';
  return 'text-red-400';
}

/**
 * Pain to Tailwind text class.
 */
export function painTextClass(pain: number): string {
  const t = clamp01(pain);
  if (t >= 0.75) return 'text-red-400';
  if (t >= 0.5) return 'text-orange-400';
  if (t >= 0.25) return 'text-amber-400';
  return 'text-emerald-400';
}

/**
 * Pain to opacity: higher pain = more visually intense.
 * Range: 0.25 (minimum visibility) to 1.0 (maximum).
 */
export function painOpacity(pain: number, maxPain: number): number {
  if (maxPain <= 0) return 0.25;
  const t = clamp01(pain / maxPain);
  return 0.25 + 0.75 * t;
}

/**
 * Confidence to left-border CSS color for table rows.
 * Returns a hex or HSL string suitable for inline style.
 */
export function confidenceBorderColor(conf: number): string {
  return confidenceColor(conf);
}
