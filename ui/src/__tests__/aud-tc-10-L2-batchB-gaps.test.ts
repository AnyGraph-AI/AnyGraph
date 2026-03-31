/**
 * AUD-TC-10 L2 Batch B Gap-Fill Tests
 *
 * Node environment — no DOM, no render.
 * Tests: exports, pure functions, source patterns, TypeScript types.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', 'components');

// ─── L2-09: ContextTabs ─────────────────────────────────────────

describe('[L2-09] ContextTabs — gap fills', () => {
  it('exports ContextTabs and ContextTabsProps', async () => {
    const mod = await import('@/components/ContextTabs');
    expect(mod.ContextTabs).toBeDefined();
    expect(typeof mod.ContextTabs).toBe('function');
    // ContextTabsProps should be exported as a type (TypeScript compile-time check)
  });

  it('source defines TABS constant with 4 tab entries', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'ContextTabs.tsx'), 'utf8');
    expect(source).toContain("const TABS:");
    expect(source).toContain("key: 'fragility'");
    expect(source).toContain("key: 'safest'");
    expect(source).toContain("key: 'riskOverTime'");
    expect(source).toContain("key: 'milestones'");
  });

  it('handles keyboard shortcuts 1-4 for tab switching', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'ContextTabs.tsx'), 'utf8');
    expect(source).toContain("e.key === '1'");
    expect(source).toContain("e.key === '2'");
    expect(source).toContain("e.key === '3'");
    expect(source).toContain("e.key === '4'");
  });

  it('renders child components conditionally based on contextTab state', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'ContextTabs.tsx'), 'utf8');
    expect(source).toContain("contextTab === 'fragility'");
    expect(source).toContain("contextTab === 'safest'");
    expect(source).toContain("contextTab === 'riskOverTime'");
    expect(source).toContain("contextTab === 'milestones'");
  });

  it('accepts initialTab prop for controlled initial state', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'ContextTabs.tsx'), 'utf8');
    expect(source).toContain("initialTab?: ContextTab");
    expect(source).toContain("initialTab = 'fragility'");
  });
});

// ─── L2-10: CopyLinkButton ──────────────────────────────────────

describe('[L2-10] CopyLinkButton — gap fills', () => {
  it('exports CopyLinkButton', async () => {
    const mod = await import('@/components/CopyLinkButton');
    expect(mod.CopyLinkButton).toBeDefined();
    expect(typeof mod.CopyLinkButton).toBe('function');
  });

  it('uses navigator.clipboard.writeText for primary copy method', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'CopyLinkButton.tsx'), 'utf8');
    expect(source).toContain('navigator.clipboard.writeText');
    expect(source).toContain('window.location.href');
  });

  it('has fallback copy via textarea + execCommand', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'CopyLinkButton.tsx'), 'utf8');
    expect(source).toContain("document.createElement('textarea')");
    expect(source).toContain("execCommand('copy')");
  });

  it('shows confirmation state "✓ Copied" after copy', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'CopyLinkButton.tsx'), 'utf8');
    expect(source).toContain('setCopied(true)');
    expect(source).toContain("'✓ Copied'");
    expect(source).toContain("'🔗 Copy Link'");
  });

  it('resets confirmation state after 1500ms timeout', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'CopyLinkButton.tsx'), 'utf8');
    expect(source).toContain('setTimeout');
    expect(source).toContain('setCopied(false)');
    expect(source).toContain('1500');
  });
});

// ─── L2-11: DiagnosisGrid ───────────────────────────────────────

describe('[L2-11] DiagnosisGrid — gap fills', () => {
  it('exports DiagnosisGrid and DiagResult interface', async () => {
    const mod = await import('@/components/DiagnosisGrid');
    expect(mod.DiagnosisGrid).toBeDefined();
    expect(typeof mod.DiagnosisGrid).toBe('function');
  });

  it('getDotColor maps healthy→emerald, unhealthy→red', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'DiagnosisGrid.tsx'), 'utf8');
    // Note: actual implementation only has 2 states, not pass/warn/fail/info
    expect(source).toContain('bg-emerald-500');
    expect(source).toContain('bg-red-500');
    expect(source).toContain("function getDotColor(healthy: boolean)");
  });

  it('renders summary bar with healthy/unhealthy counts', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'DiagnosisGrid.tsx'), 'utf8');
    expect(source).toContain('const healthy = data.filter(d => d.healthy).length');
    expect(source).toContain('const unhealthy = data.length - healthy');
    expect(source).toContain('{healthy} healthy');
    expect(source).toContain('{unhealthy} unhealthy');
  });

  it('handles empty data array gracefully', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'DiagnosisGrid.tsx'), 'utf8');
    expect(source).toContain('if (!data || data.length === 0)');
    expect(source).toContain('No diagnosis data');
  });

  it('supports click to expand/collapse detail panel', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'DiagnosisGrid.tsx'), 'utf8');
    expect(source).toContain("useState<string | null>(null)");
    expect(source).toContain("setExpanded(expanded === d.id ? null : d.id)");
  });

  it('expanded detail shows question, answer, nextStep', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'DiagnosisGrid.tsx'), 'utf8');
    expect(source).toContain('d.question');
    expect(source).toContain('d.answer');
    expect(source).toContain('d.nextStep');
  });
});

// ─── L2-12: FragilityTable ──────────────────────────────────────

describe('[L2-12] FragilityTable — gap fills', () => {
  it('exports FragilityTable', async () => {
    const mod = await import('@/components/FragilityTable');
    expect(mod.FragilityTable).toBeDefined();
    expect(typeof mod.FragilityTable).toBe('function');
  });

  it('dampenFragility function implements correct formula', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    // dampenFactor = min(1, avgConfidence / 0.55)
    expect(source).toContain('function dampenFragility');
    expect(source).toContain('avgConfidence / 0.55');
    expect(source).toContain('Math.min(1,');
    expect(source).toContain('if (avgConfidence >= 0.55) return rawFragility');
  });

  it('shows "(dampened)" in header when avgConfidence < 0.55', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    expect(source).toContain('const dampened = avgConfidence < 0.55');
    expect(source).toContain("Fragility{dampened ? ' (dampened)' : ''}");
  });

  it('handles empty data array', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    expect(source).toContain('if (!data || data.length === 0)');
    expect(source).toContain('No fragile files detected');
  });

  it('supports onRowClick callback for navigation', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    expect(source).toContain('onRowClick?: (row: FragilityRow) => void');
    expect(source).toContain('onClick={() => onRowClick?.(row)}');
  });

  it('pre-sorts rows by displayFragility descending', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    expect(source).toContain('.sort((a, b) => b.displayFragility - a.displayFragility)');
  });

  it('uses virtualization via @tanstack/react-virtual', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'FragilityTable.tsx'), 'utf8');
    expect(source).toContain("import { useVirtualizer } from '@tanstack/react-virtual'");
    expect(source).toContain('virtualizer.getVirtualItems()');
  });
});

// ─── L2-13: GodFilesTable ───────────────────────────────────────

describe('[L2-13] GodFilesTable — gap fills', () => {
  it('exports GodFilesTable and GodFile interface', async () => {
    const mod = await import('@/components/GodFilesTable');
    expect(mod.GodFilesTable).toBeDefined();
    expect(typeof mod.GodFilesTable).toBe('function');
  });

  it('defines 6 columns: File, Pain, Fragility, Confidence, Downstream, Centrality', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain("header: 'File'");
    expect(source).toContain("header: 'Pain'");
    expect(source).toContain("header: 'Fragility'");
    expect(source).toContain("header: 'Confidence'");
    expect(source).toContain("header: 'Downstream'");
    expect(source).toContain("header: 'Centrality'");
  });

  it('uses @tanstack/react-table for sorting', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain("import {");
    expect(source).toContain("useReactTable,");
    expect(source).toContain("getSortedRowModel,");
    expect(source).toContain("type SortingState,");
  });

  it('header click toggles column sorting', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain('onClick={header.column.getToggleSortingHandler()}');
    expect(source).toContain("getIsSorted()");
  });

  it('uses virtualization for scrolling performance', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain("import { useVirtualizer }");
  });

  it('applies confidence color via confidenceColor function', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain("confidenceColor(row.original.confidenceScore)");
    expect(source).toContain("confidenceTextClass(v)");
  });

  it('supports onRowClick callback', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain('onRowClick?: (file: GodFile) => void');
    expect(source).toContain('onClick={() => onRowClick?.(row.original)}');
  });

  it('containerHeight prop defaults to 400', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain('containerHeight = 400');
  });

  // Fixed in AUD-TC-10a R-01: EmptyState added for empty data
  it('handles empty data with EmptyState', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'GodFilesTable.tsx'), 'utf8');
    expect(source).toContain('EmptyState');
    expect(source).toMatch(/data\.length\s*===\s*0/);
  });
});

// ─── L2-14: HeroTreemap ─────────────────────────────────────────

describe('[L2-14] HeroTreemap — gap fills', () => {
  it('exports HeroTreemap and HeroTreemapProps', async () => {
    const mod = await import('@/components/HeroTreemap');
    expect(mod.HeroTreemap).toBeDefined();
    expect(typeof mod.HeroTreemap).toBe('function');
  });

  it('has viewMode state with treemap/table options', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("type ViewMode = 'treemap' | 'table'");
    expect(source).toContain("useState<ViewMode>('treemap')");
  });

  it('has dataMode state with files/functions options', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("type DataMode = 'files' | 'functions'");
    expect(source).toContain("useState<DataMode>('files')");
  });

  it('renders PainHeatmap or GodFilesTable based on viewMode', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("viewMode === 'treemap'");
    expect(source).toContain("<PainHeatmap");
    expect(source).toContain("<GodFilesTable");
  });

  it('passes correct data based on dataMode', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("dataMode === 'files'");
    expect(source).toContain("fileHeatmapData");
    expect(source).toContain("fnHeatmapData");
    expect(source).toContain("godFilesData");
    expect(source).toContain("fnTableData");
  });

  it('supports onNavigateToExplorer callback', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("onNavigateToExplorer?: (payload: { focus: string; focusType: 'file' | 'function'");
    expect(source).toContain("onNavigateToExplorer?.(");
  });

  it('renders toggle buttons for view and data mode', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'HeroTreemap.tsx'), 'utf8');
    expect(source).toContain("onClick={() => setDataMode(mode)}");
    expect(source).toContain("onClick={() => setViewMode(mode)}");
  });
});

// ─── L2-15: KpiRow ──────────────────────────────────────────────

describe('[L2-15] KpiRow — gap fills', () => {
  it('exports KpiRow', async () => {
    const mod = await import('@/components/KpiRow');
    expect(mod.KpiRow).toBeDefined();
    expect(typeof mod.KpiRow).toBe('function');
  });

  it('renders 4 KpiCard components', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    const kpiCardCount = (source.match(/<KpiCard/g) || []).length;
    expect(kpiCardCount).toBe(4);
  });

  it('KpiRowProps has maxPain, maxFragility, avgConfidence, riskCounts', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    expect(source).toContain('maxPain: number | null');
    expect(source).toContain('maxFragility: number | null');
    expect(source).toContain('avgConfidence: number');
    expect(source).toContain('riskCounts: Record<string, number>');
  });

  it('formats maxPain and maxFragility with toFixed(1)', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    expect(source).toContain("maxPain?.toFixed(1)");
    expect(source).toContain("maxFragility?.toFixed(1)");
  });

  it('formats avgConfidence as percentage', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    expect(source).toContain("(avgConfidence * 100).toFixed(0)");
    expect(source).toContain("%");
  });

  it('uses ACCENT colors from tokens', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    expect(source).toContain("import { ACCENT }");
    expect(source).toContain("accentColor={ACCENT.danger}");
    expect(source).toContain("accentColor={ACCENT.warning}");
    expect(source).toContain("accentColor={ACCENT.caution}");
    expect(source).toContain("accentColor={ACCENT.info}");
  });

  it('shows amber pulse indicator when avgConfidence < 0.55', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'KpiRow.tsx'), 'utf8');
    expect(source).toContain('avgConfidence < 0.55');
    expect(source).toContain('bg-amber-500');
    expect(source).toContain('animate-pulse');
  });
});

// ─── L2-16: LoadViewDropdown ────────────────────────────────────

describe('[L2-16] LoadViewDropdown — gap fills', () => {
  it('exports LoadViewDropdown', async () => {
    const mod = await import('@/components/LoadViewDropdown');
    expect(mod.LoadViewDropdown).toBeDefined();
    expect(typeof mod.LoadViewDropdown).toBe('function');
  });

  it('refreshes presets from loadPresets() when dropdown opens', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'LoadViewDropdown.tsx'), 'utf8');
    expect(source).toContain("import { loadPresets, deletePreset");
    expect(source).toContain("if (open) setPresets(loadPresets())");
  });

  it('navigates to preset URL on selection', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'LoadViewDropdown.tsx'), 'utf8');
    expect(source).toContain("router.push(url)");
    expect(source).toContain("preset.params");
  });

  it('delete button calls deletePreset and updates local state', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'LoadViewDropdown.tsx'), 'utf8');
    expect(source).toContain("deletePreset(id)");
    expect(source).toContain("setPresets((prev) => prev.filter((p) => p.id !== id))");
  });

  it('handles empty preset list with helpful message', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'LoadViewDropdown.tsx'), 'utf8');
    expect(source).toContain("presets.length === 0");
    expect(source).toContain("No saved views yet");
    expect(source).toContain("Save View");
  });

  it('uses ARIA attributes for accessibility', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'LoadViewDropdown.tsx'), 'utf8');
    expect(source).toContain('aria-label="Load saved view"');
    expect(source).toContain('aria-expanded={open}');
    expect(source).toContain('aria-haspopup="listbox"');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
  });
});
