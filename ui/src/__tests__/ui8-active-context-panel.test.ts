/**
 * UI-8 Task 3 — Active Context panel component
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('[UI-8] Active Context panel component', () => {
  it('exports ActiveContextPanel component', async () => {
    const mod = await import('@/components/active-context');

    expect(mod.ActiveContextPanel).toBeDefined();
    expect(typeof mod.ActiveContextPanel).toBe('function');
  });

  it('renders operator-priority sections and explorer quick-link callback wiring', async () => {
    const sourcePath = path.resolve(import.meta.dirname, '..', 'components', 'active-context.tsx');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('Active Context');
    expect(source).toContain('Blocked Tasks');
    expect(source).toContain('In Progress');
    expect(source).toContain('Gate Pressure');
    expect(source).toContain('onNavigateToExplorer');
    expect(source).toContain("focusType: 'file'");
    expect(source).toContain('blockedTasks.slice(0, 5)');
    expect(source).toContain('inProgressTasks.slice(0, 5)');
  });
});
