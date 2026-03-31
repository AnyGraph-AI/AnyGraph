/**
 * AUD-TC-10 Batch E Gap-Fill Tests
 * 
 * Fills coverage gaps identified in L2-33 through L2-40 audit.
 * NODE environment only — no DOM, no render(), no screen.
 * Tests module exports, pure functions, source patterns, TypeScript types.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SRC_ROOT = path.resolve(import.meta.dirname, '..');

async function readSrc(relPath: string): Promise<string> {
  return readFile(path.join(SRC_ROOT, relPath), 'utf8');
}

// ─── L2-33: loading-skeleton.tsx gaps ─────────────────────────

describe('[L2-33 GAP] KpiSkeleton renders 4 pulse placeholders', () => {
  it('source renders exactly 4 skeleton cards via [1,2,3,4].map', async () => {
    const src = await readSrc('components/ui/loading-skeleton.tsx');
    // KpiSkeleton iterates over 4 items
    expect(src).toMatch(/\[1,\s*2,\s*3,\s*4\]\.map/);
  });

  it('KpiSkeleton uses PANEL.classes for card styling', async () => {
    const src = await readSrc('components/ui/loading-skeleton.tsx');
    expect(src).toContain('PANEL.classes');
  });
});

describe('[L2-33 GAP] TreemapSkeleton renders large animated block', () => {
  it('TreemapSkeleton has min-h-[60vh] for hero sizing', async () => {
    const src = await readSrc('components/ui/loading-skeleton.tsx');
    expect(src).toContain('min-h-[60vh]');
  });

  it('TreemapSkeleton has rounded-xl border styling', async () => {
    const src = await readSrc('components/ui/loading-skeleton.tsx');
    // Within TreemapSkeleton function
    const treemapMatch = src.match(/export function TreemapSkeleton[\s\S]*?^}/m);
    expect(treemapMatch).not.toBeNull();
    expect(treemapMatch![0]).toContain('rounded-xl');
    expect(treemapMatch![0]).toContain('border');
  });
});

describe('[L2-33 GAP] PanelSkeleton default lines count', () => {
  it('PanelSkeleton defaults to 5 lines', async () => {
    const src = await readSrc('components/ui/loading-skeleton.tsx');
    expect(src).toMatch(/lines\s*=\s*5/);
  });
});

// ─── L2-34: progress-bar.tsx gaps ─────────────────────────────

describe('[L2-34 GAP] ProgressBar value/max handling', () => {
  it('clamps value to 0-100 range', async () => {
    const src = await readSrc('components/ui/progress-bar.tsx');
    // Source uses Math.min(100, Math.max(0, value))
    expect(src).toContain('Math.min(100');
    expect(src).toContain('Math.max(0');
  });

  it('exports ProgressBarProps interface with value and label', async () => {
    const mod = await import('@/components/ui/progress-bar');
    expect(mod.ProgressBar).toBeDefined();
    // TypeScript props test via source inspection
    const src = await readSrc('components/ui/progress-bar.tsx');
    expect(src).toContain('value: number');
    expect(src).toContain('label: string');
  });
});

describe('[L2-34 GAP] ProgressBar variant color mapping', () => {
  it('source defines variantColors for success/warning/default', async () => {
    const src = await readSrc('components/ui/progress-bar.tsx');
    expect(src).toContain('variantColors');
    expect(src).toContain('success:');
    expect(src).toContain('warning:');
    expect(src).toContain('default:');
    expect(src).toContain('bg-emerald-500');
    expect(src).toContain('bg-amber-500');
    expect(src).toContain('bg-blue-500');
  });
});

describe('[L2-34 GAP] ProgressBar renders label and percentage', () => {
  it('renders label text in span element', async () => {
    const src = await readSrc('components/ui/progress-bar.tsx');
    expect(src).toContain('{label}');
    expect(src).toContain('text-zinc-400');
  });

  it('renders clamped percentage with % suffix', async () => {
    const src = await readSrc('components/ui/progress-bar.tsx');
    expect(src).toContain('{clamped}%');
    expect(src).toContain('tabular-nums');
  });
});

describe('[L2-34 GAP] ProgressBar accessibility', () => {
  it('has role=progressbar with aria attributes', async () => {
    const src = await readSrc('components/ui/progress-bar.tsx');
    expect(src).toContain('role="progressbar"');
    expect(src).toContain('aria-valuenow={clamped}');
    expect(src).toContain('aria-valuemin={0}');
    expect(src).toContain('aria-valuemax={100}');
  });
});

// ─── L2-35: risk-badge.tsx gaps ─────────────────────────────

describe('[L2-35 GAP] RiskBadge tier text and styling', () => {
  it('exports RiskTier type with all four tiers', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toContain('CRITICAL');
    expect(src).toContain('HIGH');
    expect(src).toContain('MEDIUM');
    expect(src).toContain('LOW');
  });

  it('tierStyles maps each tier to correct color classes', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toContain('CRITICAL:');
    expect(src).toContain('bg-red-500');
    expect(src).toContain('text-red-400');
    expect(src).toContain('HIGH:');
    expect(src).toContain('bg-orange-500');
    expect(src).toContain('text-orange-400');
    expect(src).toContain('MEDIUM:');
    expect(src).toContain('bg-yellow-500');
    expect(src).toContain('text-yellow-400');
    expect(src).toContain('LOW:');
    expect(src).toContain('bg-emerald-500');
    expect(src).toContain('text-emerald-400');
  });
});

describe('[L2-35 GAP] RiskBadge size variants', () => {
  it('exports BadgeSize type with sm and md', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toMatch(/type BadgeSize\s*=\s*["']sm["']\s*\|\s*["']md["']/);
  });

  it('sizeStyles defines padding/font-size for each size', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toContain('sizeStyles');
    expect(src).toMatch(/sm:\s*["'][^"']*px-2[^"']*["']/);
    expect(src).toMatch(/md:\s*["'][^"']*px-2\.5[^"']*["']/);
  });

  it('defaults to md size', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toMatch(/size\s*=\s*["']md["']/);
  });
});

describe('[L2-35 GAP] RiskBadge typography', () => {
  it('uses monospace font with tracking', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toContain('font-mono');
    expect(src).toContain('tracking-');
    expect(src).toContain('tabular-nums');
  });

  it('renders tier text as content', async () => {
    const src = await readSrc('components/ui/risk-badge.tsx');
    expect(src).toContain('{tier}');
  });
});

// ─── L2-36: tabs-panel.tsx gaps ─────────────────────────────

describe('[L2-36 GAP] TabsPanel TabDef structure', () => {
  it('TabDef has key and label fields (not value)', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('key: string');
    expect(src).toContain('label: string');
    // Spec said "value" but actual implementation uses "key"
  });
});

describe('[L2-36 GAP] TabsPanel active tab highlighting', () => {
  it('compares tab.key to activeTab for isActive state', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('tab.key === activeTab');
  });

  it('applies different styles for active vs inactive tabs', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    // Active tab styling
    expect(src).toContain('bg-zinc-800/80');
    expect(src).toContain('text-zinc-100');
    expect(src).toContain('border-b-2 border-zinc-100');
    // Inactive tab styling
    expect(src).toContain('text-zinc-500');
    expect(src).toContain('hover:text-zinc-300');
  });
});

describe('[L2-36 GAP] TabsPanel onChange callback', () => {
  it('calls onTabChange with tab.key on click', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('onClick={() => onTabChange(tab.key)}');
  });

  it('onTabChange prop is typed as (key: string) => void', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('onTabChange: (key: string) => void');
  });
});

describe('[L2-36 GAP] TabsPanel children rendering', () => {
  it('renders children only for active tab', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('tab.key === activeTab ? children : null');
  });

  it('uses role=tabpanel for content area', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
  });
});

describe('[L2-36 GAP] TabsPanel keyboard navigation', () => {
  it('handles ArrowLeft/ArrowRight for tab cycling', async () => {
    const src = await readSrc('components/ui/tabs-panel.tsx');
    expect(src).toContain('ArrowRight');
    expect(src).toContain('ArrowLeft');
  });
});

// ─── L2-37: useAutoRefresh.ts gaps ─────────────────────────────

describe('[L2-37 GAP] useAutoRefresh intervalMs behavior', () => {
  it('source returns false when disabled, number when enabled', async () => {
    const src = await readSrc('hooks/useAutoRefresh.ts');
    expect(src).toContain('enabled ? intervalMs : false');
  });

  it('accepts custom intervalMs parameter with default', async () => {
    const src = await readSrc('hooks/useAutoRefresh.ts');
    expect(src).toMatch(/intervalMs\s*=\s*DEFAULT_REFRESH_INTERVAL/);
  });
});

describe('[L2-37 GAP] useAutoRefresh localStorage error handling', () => {
  it('catches localStorage errors on read', async () => {
    const src = await readSrc('hooks/useAutoRefresh.ts');
    // Has try/catch around localStorage read
    expect(src).toMatch(/try\s*\{[\s\S]*localStorage\.getItem[\s\S]*\}\s*catch/);
  });

  it('catches localStorage errors on write', async () => {
    const src = await readSrc('hooks/useAutoRefresh.ts');
    // Has try/catch around localStorage write
    expect(src).toMatch(/try\s*\{[\s\S]*localStorage\.setItem[\s\S]*\}\s*catch/);
  });
});

// ─── L2-38: useDashboardData.ts gaps ─────────────────────────

describe('[L2-38 GAP] useDashboardData query count', () => {
  it('fires 14 useQuery hooks', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    const useQueryMatches = src.match(/useQuery\(/g);
    expect(useQueryMatches).not.toBeNull();
    expect(useQueryMatches!.length).toBe(14);
  });
});

describe('[L2-38 GAP] useDashboardData loading state', () => {
  it('loading is OR of multiple isLoading states', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('loading =');
    expect(src).toContain('projectQuery.isLoading');
    expect(src).toContain('topFilesQuery.isLoading');
    expect(src).toContain('riskDistQuery.isLoading');
  });
});

describe('[L2-38 GAP] useDashboardData error handling', () => {
  it('firstError chains errors with nullish coalescing', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('firstError =');
    expect(src).toContain('projectQuery.error ??');
    // Chain terminates with null (on separate line in source)
    expect(src).toMatch(/fragilityQuery\.error\s*\?\?\s*null/);
  });

  it('errorKind uses classifyError when isError is true', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('classifyError(firstError)');
    expect(src).toContain('isError ? classifyError');
  });
});

describe('[L2-38 GAP] useDashboardData refetchAll', () => {
  it('refetchAll triggers all 14 query refetches', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('refetchAll = () =>');
    const refetchMatches = src.match(/\.refetch\(\)/g);
    expect(refetchMatches).not.toBeNull();
    expect(refetchMatches!.length).toBe(14);
  });
});

describe('[L2-38 GAP] useDashboardData computed values', () => {
  it('avgConfidence computed from heatmapQuery.data via useMemo', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('avgConfidence = useMemo');
    expect(src).toContain('heatmapQuery.data');
    expect(src).toContain('confidenceScore');
  });

  it('criticalCount extracted from riskDistQuery.data via useMemo', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('criticalCount = useMemo');
    expect(src).toContain("tier === 'CRITICAL'");
  });

  it('riskCounts aggregates all tiers from riskDistribution', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('riskCounts = useMemo');
    expect(src).toContain('riskDistQuery.data');
  });
});

describe('[L2-38 GAP] useDashboardData parameter defaults and clamping', () => {
  it('clamps days to 1-30 range', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain('Math.max(1');
    expect(src).toContain('Math.min(30');
  });

  it('defaults projectId to proj_c0d3e9a1f200', async () => {
    const src = await readSrc('hooks/useDashboardData.ts');
    expect(src).toContain("DEFAULT_PROJECT_ID = 'proj_c0d3e9a1f200'");
    expect(src).toContain('params.projectId ?? DEFAULT_PROJECT_ID');
  });
});

// ─── L2-39: useKeyboardShortcuts.ts gaps ─────────────────────

describe('[L2-39 GAP] useKeyboardShortcuts preventDefault', () => {
  it('calls event.preventDefault() before calling handler', async () => {
    const src = await readSrc('hooks/useKeyboardShortcuts.ts');
    // Order matters: preventDefault comes before handler(event)
    const handlerBlock = src.match(/if\s*\(handler\)\s*\{[\s\S]*?\}/);
    expect(handlerBlock).not.toBeNull();
    const block = handlerBlock![0];
    const preventIdx = block.indexOf('preventDefault');
    const handlerIdx = block.indexOf('handler(event)');
    expect(preventIdx).toBeLessThan(handlerIdx);
  });
});

describe('[L2-39 GAP] useKeyboardShortcuts INPUT_TAGS Set', () => {
  it('INPUT_TAGS Set includes INPUT, TEXTAREA, SELECT', async () => {
    const src = await readSrc('hooks/useKeyboardShortcuts.ts');
    expect(src).toContain("INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])");
  });
});

// ─── L2-40: command-registry.ts gaps ─────────────────────────

describe('[L2-40 GAP] COMMAND_REGISTRY completeness', () => {
  it('contains exactly 8 commands (not 10 as spec claims)', async () => {
    const { COMMAND_REGISTRY } = await import('@/lib/command-registry');
    expect(COMMAND_REGISTRY).toHaveLength(8);
  });

  it('all commands have required fields: id, title, description, command, category', async () => {
    const { COMMAND_REGISTRY } = await import('@/lib/command-registry');
    for (const cmd of COMMAND_REGISTRY) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.title).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(cmd.command).toBeTruthy();
      expect(cmd.category).toBeTruthy();
    }
  });

  it('covers all 8 command IDs', async () => {
    const { COMMAND_REGISTRY } = await import('@/lib/command-registry');
    const ids = COMMAND_REGISTRY.map(c => c.id);
    expect(ids).toContain('parse-project');
    expect(ids).toContain('enforce-edit');
    expect(ids).toContain('self-diagnosis');
    expect(ids).toContain('probe-architecture');
    expect(ids).toContain('done-check');
    expect(ids).toContain('plan-refresh');
    expect(ids).toContain('rebuild-derived');
    expect(ids).toContain('graph-metrics');
  });
});

describe('[L2-40 GAP] normalizeCommandTargetType edge cases', () => {
  it('returns null for empty string', async () => {
    const { normalizeCommandTargetType } = await import('@/lib/command-registry');
    expect(normalizeCommandTargetType('')).toBeNull();
  });

  it('returns null for whitespace only', async () => {
    const { normalizeCommandTargetType } = await import('@/lib/command-registry');
    expect(normalizeCommandTargetType('   ')).toBeNull();
  });

  it('is case-insensitive', async () => {
    const { normalizeCommandTargetType } = await import('@/lib/command-registry');
    expect(normalizeCommandTargetType('SOURCEFILE')).toBe('SourceFile');
    expect(normalizeCommandTargetType('FILE')).toBe('SourceFile');
    expect(normalizeCommandTargetType('FUNCTION')).toBe('Function');
    expect(normalizeCommandTargetType('TASK')).toBe('Task');
  });
});

describe('[L2-40 GAP] deriveSelectionFromParams fallback chain', () => {
  it('falls back to focusType/focus when selectedType/selectedValue absent', async () => {
    const { deriveSelectionFromParams } = await import('@/lib/command-registry');
    const params = {
      get: (key: string) => {
        if (key === 'focusType') return 'function';
        if (key === 'focus') return 'myFunc';
        return null;
      },
    };
    expect(deriveSelectionFromParams(params)).toEqual({ type: 'Function', value: 'myFunc' });
  });

  it('falls back to filePath when focus absent', async () => {
    const { deriveSelectionFromParams } = await import('@/lib/command-registry');
    const params = {
      get: (key: string) => {
        if (key === 'focusType') return 'file';
        if (key === 'filePath') return 'src/app.ts';
        return null;
      },
    };
    expect(deriveSelectionFromParams(params)).toEqual({ type: 'SourceFile', value: 'src/app.ts' });
  });

  it('falls back to nodeId when focus and filePath absent', async () => {
    const { deriveSelectionFromParams } = await import('@/lib/command-registry');
    const params = {
      get: (key: string) => {
        if (key === 'focusType') return 'task';
        if (key === 'nodeId') return 'task_123';
        return null;
      },
    };
    expect(deriveSelectionFromParams(params)).toEqual({ type: 'Task', value: 'task_123' });
  });

  it('returns null when no valid params exist', async () => {
    const { deriveSelectionFromParams } = await import('@/lib/command-registry');
    const params = { get: () => null };
    expect(deriveSelectionFromParams(params)).toBeNull();
  });
});

describe('[L2-40 GAP] contextualCommands escapes quotes in value', () => {
  it('escapes double quotes in SourceFile path', async () => {
    const { contextualCommands } = await import('@/lib/command-registry');
    const cmds = contextualCommands('SourceFile', '/path/with"quote.ts');
    expect(cmds[0].command).toContain('\\"');
  });

  it('escapes double quotes in Function name', async () => {
    const { contextualCommands } = await import('@/lib/command-registry');
    const cmds = contextualCommands('Function', 'func"Name');
    expect(cmds[0].command).toContain('\\"');
  });
});
