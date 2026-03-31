/**
 * AUD-TC-10 Batch A Gap-Fill Tests
 *
 * Covers gaps in L2-05, L2-06, L2-07, L2-08 identified during regression witness review.
 * NODE environment only — no DOM, no render, no @testing-library/react.
 *
 * Tests: module exports, pure function logic, source patterns via readFile, TypeScript types.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// ─── L2-05: diagnosis/page.tsx gaps ──────────────────────────

describe('[L2-05] DiagnosisPage source behavior verification', () => {
  it('has loading state with "Loading diagnosis..." text', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'diagnosis', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain('diagnosisLoading');
    expect(source).toContain('probesLoading');
    expect(source).toContain('Loading diagnosis...');
    expect(source).toContain('Loading probes...');
  });

  it('has tab state switching between diagnosis and probes', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'diagnosis', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    // Tab state type and state hook
    expect(source).toContain("type Tab = 'diagnosis' | 'probes'");
    expect(source).toContain("useState<Tab>('diagnosis')");

    // Tab switching via setTabAndUrl
    expect(source).toContain('setTabAndUrl');
    expect(source).toContain("setTabAndUrl('diagnosis')");
    expect(source).toContain("setTabAndUrl('probes')");

    // URL sync with tab param
    expect(source).toContain("params.set('tab', next)");
    expect(source).toContain('parseTab');
  });

  it('fetches from correct API endpoints', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'diagnosis', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain('/api/graph/diagnosis');
    expect(source).toContain('/api/graph/probes');
  });

  it('conditionally renders based on tab state', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'diagnosis', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    // Conditional rendering pattern
    expect(source).toContain("tab === 'diagnosis'");
    expect(source).toContain('<DiagnosisGrid');
    expect(source).toContain('<ProbeResultsGrid');
  });
});

// ─── L2-06: page.tsx gaps ────────────────────────────────────

describe('[L2-06] Dashboard source behavior verification', () => {
  it('has loading state with skeleton components', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    // Skeleton imports
    expect(source).toContain("import { KpiSkeleton, TreemapSkeleton, PanelSkeleton }");

    // Loading conditional
    expect(source).toContain('if (loading)');

    // Skeleton usage
    expect(source).toContain('<KpiSkeleton');
    expect(source).toContain('<TreemapSkeleton');
    expect(source).toContain('<PanelSkeleton');
  });

  it('uses useDashboardData hook with projectId and days params', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain('useDashboardData({ projectId, days })');
  });

  it('has openExplorer function that navigates with query params', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    // openExplorer function definition
    expect(source).toContain('const openExplorer = (payload:');
    expect(source).toContain("focus: payload.focus");
    expect(source).toContain("focusType: payload.focusType");
    expect(source).toContain("router.push(`/explorer?${search.toString()}`");
  });

  it('renders RecentlyDestabilizedAlert component', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("import { RecentlyDestabilizedAlert }");
    expect(source).toContain('<RecentlyDestabilizedAlert');
    expect(source).toContain('recentlyDestabilized?.data');
  });

  it('renders HeroTreemap composition component with all required props', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("import { HeroTreemap }");
    expect(source).toContain('<HeroTreemap');
    expect(source).toContain('fileHeatmapData=');
    expect(source).toContain('fnHeatmapData=');
    expect(source).toContain('godFilesData=');
    expect(source).toContain('fnTableData=');
    expect(source).toContain('onNavigateToExplorer=');
  });

  it('has EmptyState for filtered-out results', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("import { EmptyState }");
    expect(source).toContain('<EmptyState');
    expect(source).toContain('No files match current filters');
    expect(source).toContain('No gaps match current filters');
  });

  it('computes filter summary and panel counts', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain('const filterSummary =');
    expect(source).toContain('const panelCounts =');
    expect(source).toContain('Visible {panelCounts.topFiles}');
    expect(source).toContain('Visible {panelCounts.reality}');
    expect(source).toContain('Visible {panelCounts.fragility}');
  });
});

// ─── L2-07: AnythingGraphLogo.tsx gaps ───────────────────────

describe('[L2-07] AnythingGraphLogo source behavior verification', () => {
  it('accepts size prop with default value of 28', async () => {
    const logoPath = path.resolve(import.meta.dirname, '..', 'components', 'AnythingGraphLogo.tsx');
    const source = await readFile(logoPath, 'utf8');

    // Default parameter
    expect(source).toContain('size = 28');
  });

  it('renders SVG with viewBox 0 0 100 100', async () => {
    const logoPath = path.resolve(import.meta.dirname, '..', 'components', 'AnythingGraphLogo.tsx');
    const source = await readFile(logoPath, 'utf8');

    expect(source).toContain('viewBox="0 0 100 100"');
  });

  it('SVG width and height use size prop', async () => {
    const logoPath = path.resolve(import.meta.dirname, '..', 'components', 'AnythingGraphLogo.tsx');
    const source = await readFile(logoPath, 'utf8');

    // Both width and height bound to size
    expect(source).toContain('width={size}');
    expect(source).toContain('height={size}');
  });

  it('is a pure presentational component (no hooks except props)', async () => {
    const logoPath = path.resolve(import.meta.dirname, '..', 'components', 'AnythingGraphLogo.tsx');
    const source = await readFile(logoPath, 'utf8');

    // Should not have useState, useEffect, etc.
    expect(source).not.toContain('useState');
    expect(source).not.toContain('useEffect');
    expect(source).not.toContain('useMemo');
    expect(source).not.toContain('useCallback');
  });
});

// ─── L2-08: CommandPalette.tsx gaps ──────────────────────────

describe('[L2-08] CommandPalette source behavior verification', () => {
  it('exports commandCount equal to COMMAND_REGISTRY.length', async () => {
    const mod = await import('@/components/CommandPalette');
    const registryMod = await import('@/lib/command-registry');

    expect(mod.commandCount).toBeDefined();
    expect(typeof mod.commandCount).toBe('number');
    expect(mod.commandCount).toBe(registryMod.COMMAND_REGISTRY.length);
  });

  it('uses commandsByCategory for grouping', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain("import {");
    expect(source).toContain('commandsByCategory');
    expect(source).toContain('const grouped = useMemo(() => commandsByCategory()');
  });

  it('iterates over grouped entries with Object.entries', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain('Object.entries(grouped).map');
    expect(source).toContain('[category, commands]');
    expect(source).toContain('<CommandGroup heading={category}>');
  });

  it('has clipboard copy via copyToClipboard helper', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain('function copyToClipboard(text: string)');
    // navigator.clipboard is split across lines in source: `return navigator.clipboard\n    .writeText(text)`
    expect(source).toContain('navigator.clipboard');
    expect(source).toContain('.writeText(text)');
    expect(source).toContain('await copyToClipboard(command.command)');
  });

  it('has Escape close behavior via overlay click', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    // Overlay closes on click
    expect(source).toContain('onClick={() => setOpen(false)}');
    // Inner div stops propagation
    expect(source).toContain('onClick={(event) => event.stopPropagation()}');
  });

  it('lists commands via CommandItem with onSelect handler', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain('<CommandItem');
    expect(source).toContain('onSelect={() => void runCommand(command)}');
    expect(source).toContain('command.title');
    expect(source).toContain('command.description');
  });

  it('shows contextual commands when selection is present', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain('contextualCommands');
    expect(source).toContain('contextual.length > 0');
    expect(source).toContain('heading={`Context (${selection?.type})`}');
  });

  it('has search input via CommandInput', async () => {
    const palettePath = path.resolve(import.meta.dirname, '..', 'components', 'CommandPalette.tsx');
    const source = await readFile(palettePath, 'utf8');

    expect(source).toContain('<CommandInput');
    expect(source).toContain('placeholder="Search commands..."');
  });
});

// ─── L2-01 uniq gap-fill ─────────────────────────────────────

describe('[L2-01] uniq helper behavior (active-context/route.ts)', () => {
  it('source has uniq function that filters empty strings and deduplicates', async () => {
    const routePath = path.resolve(
      import.meta.dirname,
      '..',
      'app',
      'api',
      'graph',
      'active-context',
      'route.ts'
    );
    const source = await readFile(routePath, 'utf8');

    // Function definition
    expect(source).toContain('function uniq(values: string[]): string[]');

    // Uses Set for deduplication
    expect(source).toContain('new Set(');

    // Filters empty strings
    expect(source).toContain("v && v.trim().length > 0");
  });
});
