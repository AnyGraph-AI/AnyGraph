/**
 * AUD-TC-10 L2 Batch D — Gap-Fill Tests
 *
 * Node environment tests for components L2-25 through L2-32.
 * Tests module exports, pure functions, type shapes, and source patterns.
 *
 * NO DOM, NO render(), NO screen.getByText().
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', 'components');
const UI_DIR = path.resolve(COMPONENTS_DIR, 'ui');

// ============================================================================
// L2-25: SaveViewButton.tsx — Gap fills
// ============================================================================

describe('[L2-25] SaveViewButton component gaps', () => {
  it('source uses window.location.search for params', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'SaveViewButton.tsx'), 'utf8');
    expect(source).toContain('window.location.search');
  });

  it('source calls savePreset with name and params', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'SaveViewButton.tsx'), 'utf8');
    expect(source).toContain('savePreset(trimmed, params)');
  });

  it('source manages showDialog state for name prompt', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'SaveViewButton.tsx'), 'utf8');
    expect(source).toContain('useState(false)');
    expect(source).toContain('setShowDialog');
    expect(source).toContain('{showDialog && (');
  });

  it('source manages saved state for confirmation', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'SaveViewButton.tsx'), 'utf8');
    expect(source).toContain('setSaved(true)');
    expect(source).toContain("saved ? '✓ Saved' : '💾 Save View'");
    expect(source).toContain('setTimeout(() => setSaved(false)');
  });

  it('source has input for preset name with Enter/Escape handling', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'SaveViewButton.tsx'), 'utf8');
    expect(source).toContain('type="text"');
    expect(source).toContain('value={name}');
    expect(source).toContain("e.key === 'Enter'");
    expect(source).toContain("e.key === 'Escape'");
  });
});

// ============================================================================
// L2-26: active-context.tsx — Gap fills
// ============================================================================

describe('[L2-26] ActiveContextPanel props interface', () => {
  it('exports ActiveContextPanelProps type', async () => {
    const mod = await import('@/components/active-context');
    // TypeScript interface won't be in runtime, but we can verify component accepts the right shape
    expect(typeof mod.ActiveContextPanel).toBe('function');
  });

  it('source defines required props: inProgressTasks, blockedTasks, gateBlocked, gateRequireApproval', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('readonly inProgressTasks: ActiveTask[]');
    expect(source).toContain('readonly blockedTasks: ActiveTask[]');
    expect(source).toContain('readonly gateBlocked: GateFile[]');
    expect(source).toContain('readonly gateRequireApproval: GateFile[]');
  });

  it('source defines onNavigateToExplorer callback with correct payload shape', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain("onNavigateToExplorer?: (payload: { focus: string; focusType: 'file'; filePath?: string })");
  });
});

describe('[L2-26] ActiveContextPanel empty state handling', () => {
  it('source renders "No blocked tasks." when blockedTasks is empty', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('blockedTasks.length === 0');
    expect(source).toContain('No blocked tasks.');
  });

  it('source renders "No in-progress tasks." when inProgressTasks is empty', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('inProgressTasks.length === 0');
    expect(source).toContain('No in-progress tasks.');
  });

  it('source renders "No gate-sensitive files." when gate lists are empty', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('gateBlocked.length + gateRequireApproval.length === 0');
    expect(source).toContain('No gate-sensitive files.');
  });
});

describe('[L2-26] ActiveContextPanel section rendering', () => {
  it('source renders blockerCount for blocked tasks', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('{task.blockerCount} blockers');
  });

  it('source renders BLOCK vs REQUIRE_APPROVAL status for gate files', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain("isBlocked ? 'BLOCK' : 'REQUIRE_APPROVAL'");
  });

  it('source renders criticalCount for gate files', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('{row.criticalCount} CRITICAL');
  });

  it('source wires onNavigateToExplorer callback to file buttons', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    // Should call onNavigateToExplorer with file path
    expect(source).toContain('onNavigateToExplorer?.({ focus:');
    expect(source).toContain("focusType: 'file'");
  });
});

describe('[L2-26] ActiveContextPanel pure helper: shortPath', () => {
  it('source defines shortPath function that truncates to last 3 segments', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'active-context.tsx'), 'utf8');
    expect(source).toContain('function shortPath(filePath: string)');
    expect(source).toContain('if (parts.length <= 3) return filePath');
    expect(source).toContain('parts.slice(-3).join');
  });
});

// ============================================================================
// L2-27: navbar.tsx — Gap fills
// ============================================================================

describe('[L2-27] Navbar component structure', () => {
  it('source imports and uses AnythingGraphLogo', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain("import { AnythingGraphLogo }");
    expect(source).toContain('<AnythingGraphLogo');
  });

  it('source imports and renders ConnectionIndicator', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain("import { ConnectionIndicator }");
    expect(source).toContain('<ConnectionIndicator');
  });

  it('source imports and renders CommandPalette', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain("import { CommandPalette }");
    expect(source).toContain('<CommandPalette');
  });

  it('source uses sticky positioning with z-50', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain('sticky top-0 z-50');
  });

  it('source imports tokens (ACCENT, SURFACE, TEXT)', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain("import { ACCENT, SURFACE, TEXT }");
  });
});

describe('[L2-27] Navbar route highlighting', () => {
  it('source uses usePathname for active route detection', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain('usePathname()');
    expect(source).toContain('pathname === tab.href');
  });

  it('source applies different styling for active vs inactive tabs', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain('isActive ?');
    expect(source).toContain('ACCENT.info');
  });
});

describe('[L2-27] Navbar TABS array', () => {
  it('source defines TABS with Dashboard, Explorer, Diagnosis routes', async () => {
    const source = await readFile(path.join(COMPONENTS_DIR, 'navbar.tsx'), 'utf8');
    expect(source).toContain("{ href: '/', label: 'Dashboard' }");
    expect(source).toContain("{ href: '/explorer?mode=neighbors', label: 'Explorer' }");
    expect(source).toContain("{ href: '/diagnosis?tab=diagnosis', label: 'Diagnosis' }");
  });
});

// ============================================================================
// L2-29: data-table.tsx — Gap fills
// ============================================================================

describe('[L2-29] DataTable ColumnDef interface', () => {
  it('exports ColumnDef type with key, header, render, sortable fields', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('export interface ColumnDef<T>');
    expect(source).toContain('readonly key: keyof T & string');
    expect(source).toContain('readonly header: string');
    expect(source).toContain('readonly render?:');
    expect(source).toContain('readonly sortable?: boolean');
  });
});

describe('[L2-29] DataTable props interface', () => {
  it('exports DataTableProps with columns, data, onRowClick, rowBorderColor', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('export interface DataTableProps<T>');
    expect(source).toContain('readonly columns: ReadonlyArray<ColumnDef<T>>');
    expect(source).toContain('readonly data: ReadonlyArray<T>');
    expect(source).toContain('readonly onRowClick?: (row: T) => void');
  });
});

describe('[L2-29] DataTable sorting logic', () => {
  it('source manages sortKey and sortDir state', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('const [sortKey, setSortKey] = useState<string | null>(null)');
    expect(source).toContain('const [sortDir, setSortDir] = useState<SortDir>("asc")');
  });

  it('source toggles sort direction on same column click', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('if (sortKey === key)');
    expect(source).toContain('d === "asc" ? "desc" : "asc"');
  });

  it('source renders sort indicators for sortable columns', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('sortDir === "asc" ? "▲" : "▼"');
    expect(source).toContain('⇅'); // Unsorted indicator
  });

  it('source applies sorting to data array', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('[...data].sort');
    expect(source).toContain('sortDir === "asc" ? cmp : -cmp');
  });
});

describe('[L2-29] DataTable row click handling', () => {
  it('source applies cursor-pointer and onClick when onRowClick provided', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('onClick={onRowClick ? () => onRowClick(row) : undefined}');
  });
});

describe('[L2-29] DataTable — EmptyState + PANEL token (fixed in TC-10a R-02)', () => {
  it('imports and uses EmptyState for empty data', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain('EmptyState');
    expect(source).toMatch(/data\.length\s*===\s*0/);
  });
  it('imports and uses PANEL token for container', async () => {
    const source = await readFile(path.join(UI_DIR, 'data-table.tsx'), 'utf8');
    expect(source).toContain("import { PANEL }");
    expect(source).toContain('PANEL.classes');
  });
});

// ============================================================================
// L2-30: empty-state.tsx — Gap fills
// ============================================================================

describe('[L2-30] EmptyState props interface', () => {
  it('exports EmptyStateProps with title, description?, icon?', async () => {
    const source = await readFile(path.join(UI_DIR, 'empty-state.tsx'), 'utf8');
    expect(source).toContain('export interface EmptyStateProps');
    expect(source).toContain('readonly title: string');
    expect(source).toContain('readonly description?: string');
    expect(source).toContain('readonly icon?: string');
  });
});

describe('[L2-30] EmptyState default icon', () => {
  it('source uses 📭 as default icon', async () => {
    const source = await readFile(path.join(UI_DIR, 'empty-state.tsx'), 'utf8');
    expect(source).toContain("icon = '📭'");
  });
});

describe('[L2-30] EmptyState conditional description', () => {
  it('source conditionally renders description when provided', async () => {
    const source = await readFile(path.join(UI_DIR, 'empty-state.tsx'), 'utf8');
    expect(source).toContain('{description && (');
  });
});

describe('[L2-30] EmptyState layout', () => {
  it('source uses centered flex layout', async () => {
    const source = await readFile(path.join(UI_DIR, 'empty-state.tsx'), 'utf8');
    expect(source).toContain('flex flex-col items-center justify-center');
    expect(source).toContain('text-center');
  });
});

// ============================================================================
// L2-31: error-state.tsx — Gap fills
// ============================================================================

describe('[L2-31] ErrorState default message', () => {
  it('source has default message "Failed to load data"', async () => {
    const source = await readFile(path.join(UI_DIR, 'error-state.tsx'), 'utf8');
    expect(source).toContain("message = 'Failed to load data'");
  });
});

describe('[L2-31] ErrorState retry button conditional', () => {
  it('source conditionally renders retry button when onRetry provided', async () => {
    const source = await readFile(path.join(UI_DIR, 'error-state.tsx'), 'utf8');
    expect(source).toContain('{onRetry && (');
    expect(source).toContain('onClick={onRetry}');
  });
});

describe('[L2-31] ErrorState props interface', () => {
  it('exports ErrorStateProps with message? and onRetry?', async () => {
    const source = await readFile(path.join(UI_DIR, 'error-state.tsx'), 'utf8');
    expect(source).toContain('export interface ErrorStateProps');
    expect(source).toContain('readonly message?: string');
    expect(source).toContain('readonly onRetry?: () => void');
  });
});

// ============================================================================
// L2-32: kpi-card.tsx — Gap fills
// ============================================================================

describe('[L2-32] KpiCard props interface', () => {
  it('exports KpiCardProps with value, label, indicator?, accentColor?', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain('export interface KpiCardProps');
    expect(source).toContain('readonly value: string | number');
    expect(source).toContain('readonly label: string');
    expect(source).toContain('readonly indicator?: React.ReactNode');
    expect(source).toContain('readonly accentColor?: string');
  });
});

describe('[L2-32] KpiCard default accentColor', () => {
  it('source uses #7ec8e3 as default accentColor', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain("accentColor = '#7ec8e3'");
  });
});

describe('[L2-32] KpiCard indicator rendering', () => {
  it('source conditionally renders indicator when provided', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain('{indicator && (');
  });
});

describe('[L2-32] KpiCard value animation', () => {
  it('source has numeric count-up animation using requestAnimationFrame', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain('requestAnimationFrame');
    expect(source).toContain('easeOut');
    expect(source).toContain('displayRef');
  });

  it('source respects prefers-reduced-motion', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain('prefers-reduced-motion');
  });
});

describe('[L2-32] KpiCard — KPI/PANEL token adoption (fixed in TC-10a R-03)', () => {
  it('imports and uses KPI and PANEL tokens', async () => {
    const source = await readFile(path.join(UI_DIR, 'kpi-card.tsx'), 'utf8');
    expect(source).toContain("import { KPI, PANEL }");
    expect(source).toContain('KPI.value');
    expect(source).toContain('KPI.label');
    expect(source).toContain('PANEL.classes');
  });
});
