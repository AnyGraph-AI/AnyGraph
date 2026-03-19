/**
 * UI-V2 Phase 2/4/5 — UI primitive coverage tests
 *
 * Goal: ensure all exported UI-V2 primitive components are present and importable.
 */
import { describe, it, expect } from 'vitest';

describe('[UI-V2] primitive component exports', () => {
  it('exports KpiCard', async () => {
    const mod = await import('@/components/ui/kpi-card');
    expect(mod.KpiCard).toBeDefined();
    expect(typeof mod.KpiCard).toBe('function');
  });

  it('exports DataTable', async () => {
    const mod = await import('@/components/ui/data-table');
    expect(mod.DataTable).toBeDefined();
    expect(typeof mod.DataTable).toBe('function');
  });

  it('exports TabsPanel', async () => {
    const mod = await import('@/components/ui/tabs-panel');
    expect(mod.TabsPanel).toBeDefined();
    expect(typeof mod.TabsPanel).toBe('function');
  });

  it('exports ProgressBar', async () => {
    const mod = await import('@/components/ui/progress-bar');
    expect(mod.ProgressBar).toBeDefined();
    expect(typeof mod.ProgressBar).toBe('function');
  });

  it('exports RiskBadge', async () => {
    const mod = await import('@/components/ui/risk-badge');
    expect(mod.RiskBadge).toBeDefined();
    expect(typeof mod.RiskBadge).toBe('function');
  });
});

describe('[UI-V2] state component exports', () => {
  it('exports loading skeleton components', async () => {
    const mod = await import('@/components/ui/loading-skeleton');
    expect(mod.KpiSkeleton).toBeDefined();
    expect(mod.TreemapSkeleton).toBeDefined();
    expect(mod.PanelSkeleton).toBeDefined();
  });

  it('exports EmptyState', async () => {
    const mod = await import('@/components/ui/empty-state');
    expect(mod.EmptyState).toBeDefined();
    expect(typeof mod.EmptyState).toBe('function');
  });

  it('exports ErrorState', async () => {
    const mod = await import('@/components/ui/error-state');
    expect(mod.ErrorState).toBeDefined();
    expect(typeof mod.ErrorState).toBe('function');
  });
});
