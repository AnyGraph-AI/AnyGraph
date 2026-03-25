// Spec source: _drafts/ground-truth-hook/DESIGN.md
import { describe, it, expect, vi } from 'vitest';
import { checkBookmarkWarnings } from '../warn-enforcement.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AUD-TC-11d-05: warn-enforcement actual behavior', () => {
  it('treats in_progress as active bookmark (no NO_CLAIMED_TASK warning)', async () => {
    const neo4j = createMockNeo4j();
    neo4j.run
      .mockResolvedValueOnce([{ status: 'in_progress', taskId: 'task-1', updatedAt: new Date().toISOString(), projectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([]);

    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    expect(warnings.some((w: any) => w.code === 'NO_CLAIMED_TASK')).toBe(false);
  });

  it('also treats completing as active bookmark (same behavior)', async () => {
    const neo4j = createMockNeo4j();
    neo4j.run
      .mockResolvedValueOnce([{ status: 'completing', taskId: 'task-1', updatedAt: new Date().toISOString(), projectId: 'plan_codegraph' }])
      .mockResolvedValueOnce([]);

    const warnings = await checkBookmarkWarnings(neo4j, 'watson');
    expect(warnings).toHaveLength(0);
  });
});
