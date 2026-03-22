/**
 * UI-7 Task 2: Responsive Design — Spec Tests
 *
 * Verifies:
 * 1. KpiRow uses responsive grid (1-col mobile, 2-col tablet, 4-col desktop)
 * 2. Navbar has mobile hamburger toggle support
 * 3. page.tsx grid uses responsive breakpoints
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_ROOT = resolve(__dirname, '../../');

function readSrc(rel: string) {
  return readFileSync(resolve(UI_ROOT, 'src', rel), 'utf-8');
}

// ─── KpiRow responsive grid ───────────────────────────────────

describe('[UI-7] KpiRow responsive grid', () => {
  it('exports KpiRow', async () => {
    const mod = await import('@/components/KpiRow');
    expect(mod.KpiRow).toBeDefined();
  });

  it('uses grid-cols-1 (mobile) breakpoint', () => {
    const src = readSrc('components/KpiRow.tsx');
    expect(src).toContain('grid-cols-1');
  });

  it('uses sm:grid-cols-2 (tablet) breakpoint', () => {
    const src = readSrc('components/KpiRow.tsx');
    expect(src).toContain('sm:grid-cols-2');
  });

  it('uses lg:grid-cols-4 or xl:grid-cols-4 (desktop) breakpoint', () => {
    const src = readSrc('components/KpiRow.tsx');
    const hasDesktop = src.includes('lg:grid-cols-4') || src.includes('xl:grid-cols-4');
    expect(hasDesktop).toBe(true);
  });
});

// ─── Navbar hamburger ─────────────────────────────────────────

describe('[UI-7] Navbar mobile hamburger', () => {
  it('exports Navbar', async () => {
    const mod = await import('@/components/navbar');
    expect(mod.Navbar).toBeDefined();
  });

  it('has hamburger menu toggle state', () => {
    const src = readSrc('components/navbar.tsx');
    // Should have state for open/closed mobile menu
    const hasToggle =
      src.includes('menuOpen') ||
      src.includes('mobileOpen') ||
      src.includes('isOpen') ||
      src.includes('navOpen');
    expect(hasToggle).toBe(true);
  });

  it('has md:hidden or sm:hidden class for hamburger button', () => {
    const src = readSrc('components/navbar.tsx');
    const hasMobileOnly = src.includes('md:hidden') || src.includes('sm:hidden');
    expect(hasMobileOnly).toBe(true);
  });

  it('hides nav tabs on mobile with hidden md:flex or similar', () => {
    const src = readSrc('components/navbar.tsx');
    const hasHiddenOnMobile =
      src.includes('hidden md:flex') ||
      src.includes('hidden sm:flex') ||
      src.includes('hidden lg:flex');
    expect(hasHiddenOnMobile).toBe(true);
  });
});

// ─── page.tsx responsive layout ───────────────────────────────

describe('[UI-7] page.tsx responsive layout', () => {
  it('default export page is a function', async () => {
    const mod = await import('@/app/page');
    expect(typeof mod.default).toBe('function');
  });

  it('uses responsive grid classes for panels', () => {
    const src = readSrc('app/page.tsx');
    // The 2-column panel grid should be responsive
    expect(src).toContain('grid-cols-1');
    expect(src).toContain('lg:grid-cols-2');
  });
});
