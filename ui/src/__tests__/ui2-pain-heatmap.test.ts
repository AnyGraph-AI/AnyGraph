/**
 * UI-2: Pain Heatmap + God Files — Spec Tests
 *
 * Written FROM UI_DASHBOARD.md UI-2 tasks.
 *
 * Tasks tested:
 * 1. PainHeatmap component exists and exports properly
 * 2. GodFilesTable component exists and exports properly
 * 3. painHeatmap query returns treemap-compatible data
 * 4. View toggle between treemap and table
 * 5. Server-side LIMIT with warning
 */
import { describe, it, expect } from 'vitest';

// ─── PainHeatmap component ────────────────────────────────────

describe('[UI-2] PainHeatmap component', () => {
  it('exports a PainHeatmap component', async () => {
    const mod = await import('@/components/PainHeatmap');
    expect(mod.PainHeatmap).toBeDefined();
    expect(typeof mod.PainHeatmap).toBe('function');
  });

  it('exports PainHeatmapProps type-compatible interface', async () => {
    const mod = await import('@/components/PainHeatmap');
    // Component should accept data array and optional onCellClick
    expect(mod.PainHeatmap).toBeDefined();
  });
});

// ─── GodFilesTable component ──────────────────────────────────

describe('[UI-2] GodFilesTable component', () => {
  it('exports a GodFilesTable component', async () => {
    const mod = await import('@/components/GodFilesTable');
    expect(mod.GodFilesTable).toBeDefined();
    expect(typeof mod.GodFilesTable).toBe('function');
  });
});

// ─── Data shape validation ───────────────────────────────────

describe('[UI-2] painHeatmap query — data shape', () => {
  it('returns treemap-compatible data from live graph', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(QUERIES.painHeatmap, {
      projectId: 'proj_c0d3e9a1f200',
      limit: 20,
    });

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    // Each row must have fields needed for Recharts Treemap
    const row = rows[0] as Record<string, unknown>;
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('adjustedPain');
    expect(row).toHaveProperty('confidenceScore');
    expect(typeof row.name).toBe('string');
    expect(typeof row.adjustedPain).toBe('number');
    expect(typeof row.confidenceScore).toBe('number');
  });

  it('server-side LIMIT caps results', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(QUERIES.painHeatmap, {
      projectId: 'proj_c0d3e9a1f200',
      limit: 5,
    });

    expect(rows.length).toBeLessThanOrEqual(5);
  });
});

// ─── Function-level queries ──────────────────────────────────

describe('[UI-2] functionHeatmap query', () => {
  it('returns function-level data from live graph', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).functionHeatmap,
      { projectId: 'proj_c0d3e9a1f200', limit: 10 },
    );

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0] as Record<string, unknown>;
    expect(row).toHaveProperty('name');
    expect(row).toHaveProperty('compositeRisk');
    expect(row).toHaveProperty('riskTier');
    expect(row).toHaveProperty('fanIn');
    expect(row).toHaveProperty('fanOut');
    expect(typeof row.compositeRisk).toBe('number');
  });

  it('functionGodFiles includes parent file name', async () => {
    const { cachedQuery, clearQueryCache } = await import('@/lib/neo4j');
    const { QUERIES } = await import('@/lib/queries');
    clearQueryCache();

    const rows = await cachedQuery(
      (QUERIES as Record<string, string>).functionGodFiles,
      { projectId: 'proj_c0d3e9a1f200', limit: 5 },
    );

    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0] as Record<string, unknown>;
    expect(row).toHaveProperty('fileName');
    expect(typeof row.fileName).toBe('string');
  });
});

// ─── View toggle state ───────────────────────────────────────

describe('[UI-2] View toggle', () => {
  it('HeroTreemap has view mode toggle (treemap vs table) and data mode toggle (files vs functions)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // After UI-V2 extraction, view/data mode live in HeroTreemap, not page.tsx
    const heroPath = path.resolve(import.meta.dirname, '..', 'components', 'HeroTreemap.tsx');
    const source = await fs.readFile(heroPath, 'utf-8');

    // View mode toggle
    expect(source).toMatch(/viewMode/);
    // Data mode toggle
    expect(source).toMatch(/dataMode/);
    // Both components referenced
    expect(source).toContain('PainHeatmap');
    expect(source).toContain('GodFilesTable');
  });

  it('useDashboardData hook fetches function queries', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const hookPath = path.resolve(import.meta.dirname, '..', 'hooks', 'useDashboardData.ts');
    const source = await fs.readFile(hookPath, 'utf-8');

    expect(source).toContain('functionHeatmap');
    expect(source).toContain('functionGodFiles');
  });
});
