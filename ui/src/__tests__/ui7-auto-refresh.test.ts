/**
 * UI-7 — Auto-refresh toggle with React Query refetchInterval
 * Tests run in node environment — verifies module structure + source patterns.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const HOOKS_DIR = path.resolve(import.meta.dirname, '..', 'hooks');

describe('[UI-7] useAutoRefresh hook', () => {
  it('useAutoRefresh can be imported', async () => {
    const mod = await import('@/hooks/useAutoRefresh');
    expect(typeof mod.useAutoRefresh).toBe('function');
  });

  it('exports DEFAULT_REFRESH_INTERVAL of 30 seconds', async () => {
    const mod = await import('@/hooks/useAutoRefresh');
    expect(mod.DEFAULT_REFRESH_INTERVAL).toBe(30_000);
  });

  it('exports REFRESH_STORAGE_KEY', async () => {
    const mod = await import('@/hooks/useAutoRefresh');
    expect(typeof mod.REFRESH_STORAGE_KEY).toBe('string');
    expect(mod.REFRESH_STORAGE_KEY.length).toBeGreaterThan(0);
  });

  it('source uses localStorage to persist preference', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useAutoRefresh.ts'), 'utf8');
    expect(source).toContain('localStorage');
    expect(source).toContain('REFRESH_STORAGE_KEY');
  });

  it('source returns enabled, toggle, and intervalMs', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useAutoRefresh.ts'), 'utf8');
    expect(source).toContain('enabled');
    expect(source).toContain('toggle');
    expect(source).toContain('intervalMs');
  });

  it('source guards against SSR (typeof window)', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useAutoRefresh.ts'), 'utf8');
    expect(source).toContain("typeof window");
  });
});

describe('[UI-7] useDashboardData auto-refresh integration', () => {
  it('useDashboardData source accepts refetchInterval option', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    expect(source).toContain('refetchInterval');
  });

  it('useDashboardData source wires refetchInterval into useQuery calls', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    // refetchInterval should appear more than once (wired into queries)
    const matches = source.match(/refetchInterval/g);
    expect(matches).not.toBeNull();
    expect((matches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('useDashboardData params type includes refetchInterval', async () => {
    const source = await readFile(path.join(HOOKS_DIR, 'useDashboardData.ts'), 'utf8');
    // DashboardFilterParams should mention refetchInterval
    expect(source).toContain('refetchInterval');
  });
});
