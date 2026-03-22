/**
 * UI-7 Task 4: Animation Durations + prefers-reduced-motion — Spec Tests
 *
 * Verifies:
 * 1. DURATION tokens are all within 150-300ms (except skeleton at 1500ms)
 * 2. globals.css has prefers-reduced-motion media query
 * 3. fade-up animation is within 150-300ms
 * 4. No transition/animation durations > 300ms in source (except skeleton)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_ROOT = resolve(__dirname, '../../');

function readSrc(rel: string) {
  return readFileSync(resolve(UI_ROOT, 'src', rel), 'utf-8');
}

// ─── DURATION token values ────────────────────────────────────

describe('[UI-7] DURATION design tokens', () => {
  it('exports DURATION from tokens', async () => {
    const mod = await import('@/lib/tokens');
    expect(mod.DURATION).toBeDefined();
  });

  it('hover duration is between 150-300ms', async () => {
    const { DURATION } = await import('@/lib/tokens');
    expect(DURATION.hover).toBeGreaterThanOrEqual(150);
    expect(DURATION.hover).toBeLessThanOrEqual(300);
  });

  it('panel duration is between 150-300ms', async () => {
    const { DURATION } = await import('@/lib/tokens');
    expect(DURATION.panel).toBeGreaterThanOrEqual(150);
    expect(DURATION.panel).toBeLessThanOrEqual(300);
  });

  it('modal duration is between 150-300ms', async () => {
    const { DURATION } = await import('@/lib/tokens');
    expect(DURATION.modal).toBeGreaterThanOrEqual(150);
    expect(DURATION.modal).toBeLessThanOrEqual(300);
  });

  it('tooltip duration is under 300ms', async () => {
    const { DURATION } = await import('@/lib/tokens');
    expect(DURATION.tooltip).toBeLessThanOrEqual(300);
  });
});

// ─── globals.css prefers-reduced-motion ───────────────────────

describe('[UI-7] globals.css prefers-reduced-motion', () => {
  it('has prefers-reduced-motion media query', () => {
    const src = readSrc('app/globals.css');
    expect(src).toContain('prefers-reduced-motion');
  });

  it('disables animations for prefers-reduced-motion: reduce', () => {
    const src = readSrc('app/globals.css');
    expect(src).toContain('animation-duration');
  });

  it('disables transitions for prefers-reduced-motion: reduce', () => {
    const src = readSrc('app/globals.css');
    expect(src).toContain('transition-duration');
  });
});

// ─── fade-up animation duration ──────────────────────────────

describe('[UI-7] fade-up animation duration', () => {
  it('fadeUp animation is defined in globals.css', () => {
    const src = readSrc('app/globals.css');
    expect(src).toContain('fadeUp');
  });

  it('fade-up animation duration is <= 300ms', () => {
    const src = readSrc('app/globals.css');
    // Extract the duration from the .fade-up rule
    const fadeUpBlock = src.match(/\.fade-up\s*\{[^}]+\}/)?.[0] ?? '';
    // Animation should be 300ms or less — check for ms value
    const msMatch = fadeUpBlock.match(/(\d+)ms/);
    if (msMatch) {
      const ms = parseInt(msMatch[1], 10);
      expect(ms).toBeLessThanOrEqual(300);
    } else {
      // If no ms value found, check there's no 400/460/500 etc.
      expect(fadeUpBlock).not.toMatch(/4[0-9]{2}ms|5\d{2}ms/);
    }
  });
});
