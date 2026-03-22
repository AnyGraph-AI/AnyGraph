/**
 * UI-V1: Design tokens — spacing, typography, z-index scales.
 *
 * Sourced from UI_DASHBOARD.md spec + ui-ux-pro-max skill guidelines.
 * Import these instead of hardcoding values in components.
 */

/** Spacing scale (in px). Use as Tailwind arbitrary values: `p-[${SPACE[4]}px]` */
export const SPACE = {
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

/** Typography scale — font sizes with matched line-heights */
export const TEXT = {
  xs:   { size: '0.75rem',  lineHeight: '1rem' },     // 12px
  sm:   { size: '0.875rem', lineHeight: '1.25rem' },   // 14px
  base: { size: '1rem',     lineHeight: '1.5rem' },    // 16px
  lg:   { size: '1.125rem', lineHeight: '1.75rem' },   // 18px
  xl:   { size: '1.25rem',  lineHeight: '1.75rem' },   // 20px
  '2xl': { size: '1.5rem',  lineHeight: '2rem' },      // 24px
  '3xl': { size: '1.875rem', lineHeight: '2.25rem' },  // 30px
} as const;

/** Z-index scale — never use arbitrary z-index values */
export const Z = {
  base: 0,
  raised: 10,
  dropdown: 20,
  sticky: 30,
  modalBackdrop: 40,
  modal: 50,
  toast: 60,
  tooltip: 70,
  commandPalette: 80,
} as const;

/** Animation durations (ms) — from ux-guidelines.csv */
export const DURATION = {
  hover: 150,
  panel: 200,
  skeleton: 1500,
  tooltip: 100,
  modal: 200,
} as const;

/** Panel card styling — consistent across all panels */
export const PANEL = {
  /** Standard panel background + border classes */
  classes: 'bg-zinc-900/80 border border-zinc-800/60 rounded-xl',
  /** Standard panel inner padding */
  padding: 'p-5',
  /** Panel header text classes */
  headerText: 'text-base font-semibold text-zinc-100',
  /** Panel description text classes */
  descText: 'text-xs text-zinc-500 mt-1',
} as const;

/** KPI card styling */
export const KPI = {
  /** Value text */
  value: 'text-3xl font-bold text-zinc-50 tabular-nums',
  /** Label text */
  label: 'text-xs uppercase tracking-wide text-zinc-500 mt-1',
} as const;

/** Accent color palette — semantic accent colors for KPI cards, nav active state, and risk indicators */
export const ACCENT = {
  danger:  '#ff4757',  // Critical / Max Pain
  warning: '#ff7f50',  // Fragility / high-risk
  caution: '#ffc048',  // Confidence warning
  info:    '#7ec8e3',  // Info / active nav state
} as const;

/** Surface colors — panel, nav, and overlay backgrounds */
export const SURFACE = {
  nav: '#0a0c10',      // Navbar background (use with opacity suffix: + 'D9' for 85%)
} as const;
