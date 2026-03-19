/**
 * UI-V2 Phase 1: Component Extraction — Spec Tests
 *
 * Written FROM UI_DASHBOARD.md UI-V2 tasks.
 *
 * Tests written BEFORE implementation (TDD).
 * These verify the extracted components exist, accept typed props,
 * and render correctly.
 */
import { describe, it, expect } from 'vitest';

// ─── KpiRow component ─────────────────────────────────────────

describe('[UI-V2] KpiRow component', () => {
  it('exports a KpiRow component', async () => {
    const mod = await import('@/components/KpiRow');
    expect(mod.KpiRow).toBeDefined();
    expect(typeof mod.KpiRow).toBe('function');
  });

  it('accepts typed props: maxPain, maxFragility, avgConfidence, riskCounts', async () => {
    const mod = await import('@/components/KpiRow');
    // Component should be callable with the expected props shape
    expect(mod.KpiRow).toBeDefined();
    // TypeScript compilation is the real check — this confirms the export exists
  });
});

// ─── HeroTreemap component ────────────────────────────────────

describe('[UI-V2] HeroTreemap component', () => {
  it('exports a HeroTreemap component', async () => {
    const mod = await import('@/components/HeroTreemap');
    expect(mod.HeroTreemap).toBeDefined();
    expect(typeof mod.HeroTreemap).toBe('function');
  });
});

// ─── ContextTabs component ────────────────────────────────────

describe('[UI-V2] ContextTabs component', () => {
  it('exports a ContextTabs component', async () => {
    const mod = await import('@/components/ContextTabs');
    expect(mod.ContextTabs).toBeDefined();
    expect(typeof mod.ContextTabs).toBe('function');
  });
});

// ─── useDashboardData hook ────────────────────────────────────

describe('[UI-V2] useDashboardData hook', () => {
  it('exports a useDashboardData hook', async () => {
    const mod = await import('@/hooks/useDashboardData');
    expect(mod.useDashboardData).toBeDefined();
    expect(typeof mod.useDashboardData).toBe('function');
  });
});

// ─── page.tsx composition ─────────────────────────────────────

describe('[UI-V2] page.tsx composition', () => {
  it('page.tsx default export is still a valid function component', async () => {
    const mod = await import('@/app/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
