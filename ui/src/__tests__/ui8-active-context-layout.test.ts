/**
 * UI-8 Task 4 — Active Context layout wiring
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('[UI-8] Active Context layout wiring', () => {
  it('dashboard page wires ActiveContextPanel as top-row panel', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("import { ActiveContextPanel } from '@/components/active-context'");
    expect(source).toContain('<ActiveContextPanel');
    expect(source).toContain('activeContextData?.data?.inProgressTasks');
    expect(source).toContain('activeContextData?.data?.blockedTasks');
    expect(source).toContain('activeContextData?.data?.gateBlocked');
    expect(source).toContain('activeContextData?.data?.gateRequireApproval');
    expect(source).toContain('onNavigateToExplorer={openExplorer}');
  });

  it('useDashboardData fetches active context route keyed by project', async () => {
    const hookPath = path.resolve(import.meta.dirname, '..', 'hooks', 'useDashboardData.ts');
    const source = await readFile(hookPath, 'utf8');

    expect(source).toContain('fetchActiveContext');
    expect(source).toContain('/api/graph/active-context?projectId=');
    expect(source).toContain("queryKey: ['active-context', projectId]");
    expect(source).toContain('activeContextData');
  });
});
