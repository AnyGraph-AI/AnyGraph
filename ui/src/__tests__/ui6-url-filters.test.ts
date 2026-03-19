/**
 * UI-6 Task 5 — URL search param filters
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('[UI-6] URL filter wiring', () => {
  it('dashboard page reads and writes major filters via URL params', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("params.get('project')");
    expect(source).toContain("params.get('risk')");
    expect(source).toContain("params.get('minConfidence')");
    expect(source).toContain("params.get('days')");
    expect(source).toContain('window.location.search');
    expect(source).toContain('window.history.replaceState');
    expect(source).toContain('router.replace(nextUrl)');
    expect(source).toContain('setFilter({ project: e.target.value })');
    expect(source).toContain('setFilter({ risk: e.target.value })');
    expect(source).toContain('setFilter({ minConfidence: String(Number(e.target.value) / 100) })');
    expect(source).toContain('setFilter({ days: e.target.value })');
  });

  it('useDashboardData accepts project/day filters and keys queries by params', async () => {
    const hookPath = path.resolve(import.meta.dirname, '..', 'hooks', 'useDashboardData.ts');
    const source = await readFile(hookPath, 'utf8');

    expect(source).toContain('type DashboardFilterParams');
    expect(source).toContain('projectId?: string');
    expect(source).toContain('days?: number');
    expect(source).toContain("queryKey: ['project-summary', projectId]");
    expect(source).toContain("queryKey: ['recently-destabilized', projectId, days]");
    expect(source).toContain('days = Math.max(1, Math.min(30, params.days ?? 7))');
  });
});
