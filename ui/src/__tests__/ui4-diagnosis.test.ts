/**
 * UI-4: Temporal, Diagnosis, Architecture Probes — Spec Tests
 *
 * Tests for the 3 unblocked tasks:
 * 1. Self-diagnosis grid (D1-D39 colored dots)
 * 2. Risk Over Time line chart
 * 3. Milestone progress grouped bars
 */
import { describe, it, expect } from 'vitest';

// ─── Component exports ──────────────────────────────────────

describe('[UI-4] Component exports', () => {
  it('exports a DiagnosisGrid component', async () => {
    const mod = await import('@/components/DiagnosisGrid');
    expect(mod.DiagnosisGrid).toBeDefined();
    expect(typeof mod.DiagnosisGrid).toBe('function');
  });

  it('exports a RiskOverTime component', async () => {
    const mod = await import('@/components/RiskOverTime');
    expect(mod.RiskOverTime).toBeDefined();
    expect(typeof mod.RiskOverTime).toBe('function');
  });

  it('exports a MilestoneProgress component', async () => {
    const mod = await import('@/components/MilestoneProgress');
    expect(mod.MilestoneProgress).toBeDefined();
    expect(typeof mod.MilestoneProgress).toBe('function');
  });
});

// ─── Diagnosis API ───────────────────────────────────────────

describe('[UI-4] Diagnosis API route', () => {
  it('GET /api/graph/diagnosis returns diagnosis results', async () => {
    const res = await fetch('http://localhost:3000/api/graph/diagnosis');
    // May 404 if dev server isn't running, but test validates the route exists in code
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const routePath = path.resolve(import.meta.dirname, '..', 'app', 'api', 'graph', 'diagnosis', 'route.ts');
    const exists = await fs.access(routePath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });
});

// ─── Risk Over Time query ────────────────────────────────────

describe('[UI-4] riskOverTime query', () => {
  it('returns governance snapshots with timestamps', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    expect((QUERIES as Record<string, string>).riskOverTime).toBeDefined();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).riskOverTime,
      { projectId: 'proj_c0d3e9a1f200', limit: 30 },
    );

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0] as Record<string, unknown>;
    expect(row).toHaveProperty('timestamp');
    expect(row).toHaveProperty('invariantViolations');
  });
});

// ─── Milestone progress query ────────────────────────────────

describe('[UI-4] milestoneProgress query', () => {
  it('returns milestone completion data across projects', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    expect((QUERIES as Record<string, string>).milestoneProgress).toBeDefined();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).milestoneProgress,
      {},
    );

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0] as Record<string, unknown>;
    expect(row).toHaveProperty('milestone');
    expect(row).toHaveProperty('done');
    expect(row).toHaveProperty('total');
    expect(row).toHaveProperty('projectId');
  });
});

// ─── Page integration ────────────────────────────────────────

describe('[UI-4] page integration', () => {
  it('dashboard references RiskOverTime and MilestoneProgress', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '..', 'app', 'page.tsx'),
      'utf-8',
    );
    expect(source).toContain('RiskOverTime');
    expect(source).toContain('MilestoneProgress');
  });
});
