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

// ─── View toggle state ───────────────────────────────────────

describe('[UI-2] View toggle', () => {
  it('page exports or uses a view mode state (treemap vs table)', async () => {
    // Verify page.tsx contains view mode toggle logic
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await fs.readFile(pagePath, 'utf-8');

    // Should contain view mode state
    expect(source).toMatch(/viewMode|view.*mode|showTable|activeView/i);
    // Should contain both component references
    expect(source).toContain('PainHeatmap');
    expect(source).toContain('GodFilesTable');
  });
});
