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
    expect(source).toContain('filterSummary');
    expect(source).toContain('Visible {panelCounts.topFiles}');
  });

  it('normalizes canonical GC-11 tiers and avoids implicit LOW fallback', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain('const TIER_BY_NUM');
    expect(source).toContain('function normalizeTier');
    expect(source).toContain("row.riskTier ?? row.maxTier ?? ''");
    expect(source).toContain("row.riskTierNum ?? row.maxTierNum ?? 0");
    expect(source).not.toContain("row.riskTier ?? row.maxTier ?? 'LOW'");
    expect(source).toContain('<option value="CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN">ALL</option>');
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

  it('file-level query contracts include canonical riskTier + riskTierNum for global filter parity', async () => {
    const queriesPath = path.resolve(import.meta.dirname, '..', 'lib', 'queries.ts');
    const source = await readFile(queriesPath, 'utf8');

    // godFiles contract
    expect(source).toContain('godFiles: `');
    expect(source).toContain("coalesce(sf.riskTier, 'UNKNOWN') AS riskTier");
    expect(source).toContain('coalesce(sf.riskTierNum, 0) AS riskTierNum');

    // fragilityIndex contract
    expect(source).toContain('fragilityIndex: `');
    expect(source).toContain("coalesce(sf.riskTier, 'UNKNOWN') AS riskTier");
    expect(source).toContain('coalesce(sf.riskTierNum, 0) AS riskTierNum');
  });
});
