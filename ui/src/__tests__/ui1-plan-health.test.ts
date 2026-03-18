/**
 * UI-1: Plan Health Panel + Label Fix — Spec Tests
 *
 * Written FROM UI_DASHBOARD.md UI-1 tasks (DECISION-FORMULA-REVIEW-2026-03-17).
 *
 * Tasks:
 * 1. Fix header label: Max Pain card shows maxAdjustedPain (not maxPainScore)
 * 2. Add Project Health panel: milestone progress, task readiness, evidence gaps
 * 3. Add planHealth query to queries.ts
 */
import { describe, it, expect } from 'vitest';

// ─── Task 3: planHealth query exists in queries.ts ─────────────

describe('[UI-1] queries.ts — planHealth query', () => {
  it('exports planHealth query key', async () => {
    const { QUERIES } = await import('@/lib/queries');
    expect(QUERIES).toHaveProperty('planHealth');
    expect(typeof (QUERIES as Record<string, string>).planHealth).toBe('string');
  });

  it('planHealth query contains milestone aggregation', async () => {
    const { QUERIES } = await import('@/lib/queries');
    const q = (QUERIES as Record<string, string>).planHealth.toUpperCase();
    expect(q).toContain('MILESTONE');
    expect(q).toContain('TASK');
  });

  it('planHealth query is read-only (no mutations)', async () => {
    const { QUERIES } = await import('@/lib/queries');
    const q = (QUERIES as Record<string, string>).planHealth.toUpperCase();
    expect(q).not.toContain('MERGE');
    expect(q).not.toContain('CREATE');
    expect(q).not.toContain('DELETE');
    expect(q).not.toContain('SET ');
  });

  it('planHealth query returns data from live graph', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).planHealth,
      { projectId: 'plan_codegraph' },
    );

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0] as Record<string, unknown>;
    // Must return milestone/task aggregation fields
    expect(row).toHaveProperty('totalMilestones');
    expect(row).toHaveProperty('doneMilestones');
    expect(row).toHaveProperty('totalTasks');
    expect(row).toHaveProperty('doneTasks');
    expect(row).toHaveProperty('readyTasks');
    expect(row).toHaveProperty('blockedTasks');
  });
});

// ─── Task 1: Header label fix ─────────────────────────────────

describe('[UI-1] Dashboard header — Max Pain label', () => {
  it('page.tsx references maxAdjustedPain for the Max Pain card (not maxPainScore)', async () => {
    // Read the source file and check the card renders maxAdjustedPain
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await fs.readFile(pagePath, 'utf-8');

    // The Max Pain card should use maxAdjustedPain
    expect(source).toContain('maxAdjustedPain');

    // It should NOT use maxPainScore for the "Max Pain" display value
    // (maxPainScore may still be referenced elsewhere, but the card value should be maxAdjustedPain)
    const maxPainCardMatch = source.match(/label:\s*['"]Max Pain['"].*?value:\s*(.*?)}/s);
    if (maxPainCardMatch) {
      expect(maxPainCardMatch[1]).toContain('maxAdjustedPain');
      expect(maxPainCardMatch[1]).not.toContain('maxPainScore');
    }
  });
});
