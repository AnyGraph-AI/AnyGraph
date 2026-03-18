/**
 * UI-3: Reality Gap and Fragility — Spec Tests
 *
 * Tests written FROM the UI_DASHBOARD.md UI-3 spec.
 *
 * Spec requirements:
 * 1. Reality Gap panel with dynamic expectedEvidence by tier
 * 2. Fragility Index table with evidence threshold filter
 * 3. Risk distribution bar chart by tier
 * 4. Safest Next Action panel (low risk + high confidence)
 */
import { describe, it, expect } from 'vitest';

// ─── Component exports ──────────────────────────────────────

describe('[UI-3] Component exports', () => {
  it('exports a RealityGap component', async () => {
    const mod = await import('@/components/RealityGap');
    expect(mod.RealityGap).toBeDefined();
    expect(typeof mod.RealityGap).toBe('function');
  });

  it('exports a FragilityTable component', async () => {
    const mod = await import('@/components/FragilityTable');
    expect(mod.FragilityTable).toBeDefined();
    expect(typeof mod.FragilityTable).toBe('function');
  });

  it('exports a RiskDistributionChart component', async () => {
    const mod = await import('@/components/RiskDistributionChart');
    expect(mod.RiskDistributionChart).toBeDefined();
    expect(typeof mod.RiskDistributionChart).toBe('function');
  });

  it('exports a SafestAction component', async () => {
    const mod = await import('@/components/SafestAction');
    expect(mod.SafestAction).toBeDefined();
    expect(typeof mod.SafestAction).toBe('function');
  });
});

// ─── Reality Gap query ───────────────────────────────────────

describe('[UI-3] realityGap query', () => {
  it('returns files with gap between confidence and evidence count', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    expect((QUERIES as Record<string, string>).realityGap).toBeDefined();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).realityGap,
      { projectId: 'proj_c0d3e9a1f200', limit: 50 },
    );

    expect(Array.isArray(rows)).toBe(true);
    // Should have gap-related fields
    if (rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('confidenceScore');
      expect(row).toHaveProperty('evidenceCount');
      expect(row).toHaveProperty('expectedEvidence');
      expect(row).toHaveProperty('gapScore');
    }
  });
});

// ─── Fragility query ─────────────────────────────────────────

describe('[UI-3] fragility query', () => {
  it('returns files ranked by fragility with evidence count', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    expect((QUERIES as Record<string, string>).fragilityIndex).toBeDefined();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).fragilityIndex,
      { projectId: 'proj_c0d3e9a1f200', limit: 50 },
    );

    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('fragility');
      expect(row).toHaveProperty('confidenceScore');
      expect(row).toHaveProperty('adjustedPain');
    }
  });
});

// ─── Safest Action query ─────────────────────────────────────

describe('[UI-3] safestAction query', () => {
  it('returns low-risk high-confidence files', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    expect((QUERIES as Record<string, string>).safestAction).toBeDefined();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).safestAction,
      { projectId: 'proj_c0d3e9a1f200', limit: 10 },
    );

    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      const row = rows[0] as Record<string, unknown>;
      expect(row).toHaveProperty('name');
      expect(row).toHaveProperty('confidenceScore');
      expect(row).toHaveProperty('adjustedPain');
    }
  });
});

// ─── Reality Gap filter controls ─────────────────────────────

describe('[UI-3] RealityGap filter props', () => {
  it('RealityGap accepts severityFilter and minGap props', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '..', 'components', 'RealityGap.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/severityFilter/);
    expect(source).toMatch(/minGap/);
  });
});

// ─── Snooze button ───────────────────────────────────────────

describe('[UI-3] Gap snooze', () => {
  it('RealityGap has snooze functionality', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '..', 'components', 'RealityGap.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/snooze|snoozed/i);
    expect(source).toMatch(/localStorage/);
  });
});

// ─── Confidence banner ──────────────────────────────────────

describe('[UI-3] Confidence banner', () => {
  it('page.tsx has confidence banner logic', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '..', 'app', 'page.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/avgConfidence|averageConfidence/);
    expect(source).toMatch(/0\.55/);
  });
});

// ─── Dampening formula ──────────────────────────────────────

describe('[UI-3] Fragility dampening', () => {
  it('FragilityTable shows dampened values when global confidence is low', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(import.meta.dirname, '..', 'components', 'FragilityTable.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/avgConfidence|globalConfidence|dampen/i);
  });
});

// ─── Page integration ────────────────────────────────────────

describe('[UI-3] page.tsx integration', () => {
  it('page references all UI-3 components', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await fs.readFile(pagePath, 'utf-8');

    expect(source).toContain('RealityGap');
    expect(source).toContain('FragilityTable');
    expect(source).toContain('RiskDistributionChart');
    expect(source).toContain('SafestAction');
  });
});
