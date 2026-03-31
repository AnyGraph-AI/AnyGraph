/**
 * AUD-TC-10-L1-batchA: Spec-derived tests for 6 UI files
 *
 * Environment: NODE (no jsdom, no DOM APIs)
 * Test approach: Dynamic imports for export checks, fs.readFile for source pattern assertions
 *
 * Files covered:
 * - L1-03: layout.tsx (7 behaviors)
 * - L1-04: connection-indicator.tsx (6 behaviors)
 * - L1-05: ExplorerFocus.tsx (6 behaviors)
 * - L1-07: query-provider.tsx (4 behaviors)
 * - L1-08: RecentlyDestabilizedAlert.tsx (6 behaviors)
 * - L1-15: explorer/page.tsx (4 behaviors)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

const UI_SRC = join(__dirname, '..');

describe('[AUD-TC-10-L1-03] layout.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'app/layout.tsx'), 'utf-8');
  });

  it('exports metadata with title "AnythingGraph"', () => {
    // Source pattern: export const metadata: Metadata = { title: "AnythingGraph", ...
    expect(source).toContain('export const metadata');
    expect(source).toContain('title: "AnythingGraph"');
  });

  it('exports metadata with description containing "Universal Reasoning Graph"', () => {
    expect(source).toContain('description:');
    expect(source).toContain('Universal Reasoning Graph');
  });

  it('renders html with dark mode class', () => {
    expect(source).toMatch(/className=["']dark["']/);
    expect(source).toContain('<html lang="en" className="dark">');
  });

  it('wraps children in QueryProvider', () => {
    expect(source).toContain('<QueryProvider>');
    expect(source).toContain('</QueryProvider>');
    // Verify QueryProvider is imported (uses double quotes in source)
    expect(source).toContain('from "@/components/query-provider"');
  });

  it('renders Navbar before main', () => {
    const navbarIndex = source.indexOf('<Navbar');
    const mainIndex = source.indexOf('<main');
    expect(navbarIndex).toBeGreaterThan(-1);
    expect(mainIndex).toBeGreaterThan(-1);
    expect(navbarIndex).toBeLessThan(mainIndex);
  });

  it('has max-w-[1400px] constraint on main', () => {
    expect(source).toContain('max-w-[1400px]');
  });

  it('loads Geist and Geist_Mono fonts', () => {
    // Source uses double quotes
    expect(source).toContain('from "next/font/google"');
    expect(source).toMatch(/Geist\(/);
    expect(source).toMatch(/Geist_Mono\(/);
    expect(source).toContain('--font-geist-sans');
    expect(source).toContain('--font-geist-mono');
  });

  it('has body with bg-[#0a0c10] background', () => {
    expect(source).toContain('bg-[#0a0c10]');
  });
});

describe('[AUD-TC-10-L1-04] connection-indicator.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'components/connection-indicator.tsx'), 'utf-8');
  });

  it('exports ConnectionIndicator component', async () => {
    const mod = await import('../components/connection-indicator');
    expect(mod.ConnectionIndicator).toBeDefined();
    expect(typeof mod.ConnectionIndicator).toBe('function');
  });

  it('polls /api/graph/query endpoint', () => {
    expect(source).toContain("fetch('/api/graph/query')");
  });

  it('uses setInterval for polling with 30s interval', () => {
    expect(source).toContain('setInterval');
    expect(source).toMatch(/setInterval\(check,\s*30[_,]?000\)/);
  });

  it('displays green pulsing dot when connected (emerald + animate-pulse)', () => {
    expect(source).toContain('bg-emerald-400');
    expect(source).toContain('animate-pulse');
    expect(source).toContain('shadow-[0_0_10px_rgba(52,211,153,0.55)]');
  });

  it('displays red dot when disconnected', () => {
    expect(source).toContain('bg-red-500');
  });

  it('displays zinc dot for loading state (connected === null)', () => {
    expect(source).toContain('bg-zinc-500');
    expect(source).toContain('connected === null');
  });

  it('shows "Disconnected" text when connected === false', () => {
    expect(source).toContain("'Disconnected'");
    expect(source).toContain("connected === false ? 'Disconnected' : 'Neo4j'");
  });

  it('cleans up interval on unmount (clearInterval)', () => {
    expect(source).toContain('clearInterval');
    expect(source).toMatch(/return\s*\(\)\s*=>\s*clearInterval\(interval\)/);
  });
});

describe('[AUD-TC-10-L1-05] ExplorerFocus.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'components/ExplorerFocus.tsx'), 'utf-8');
  });

  it('exports ExplorerFocus component', async () => {
    const mod = await import('../components/ExplorerFocus');
    expect(mod.ExplorerFocus).toBeDefined();
    expect(typeof mod.ExplorerFocus).toBe('function');
  });

  it('reads focus, focusType, filePath from URL search params', () => {
    expect(source).toContain("from 'next/navigation'");
    expect(source).toContain('useSearchParams');
    expect(source).toContain("params.get('focus')");
    expect(source).toContain("params.get('focusType')");
    expect(source).toContain("params.get('filePath')");
  });

  it('defaults focus to "unknown" when param missing', () => {
    expect(source).toMatch(/params\.get\(['"]focus['"]\)\s*\?\?\s*['"]unknown['"]/);
  });

  it('defaults focusType to "node" when param missing', () => {
    expect(source).toMatch(/params\.get\(['"]focusType['"]\)\s*\?\?\s*['"]node['"]/);
  });

  it('renders focusType and focus as badge pills', () => {
    expect(source).toContain('type: {focusType}');
    expect(source).toContain('focus: {focus}');
    expect(source).toContain('rounded-full');
    expect(source).toContain('border');
  });

  it('conditionally renders filePath badge only when present', () => {
    expect(source).toMatch(/\{filePath\s*\?\s*\(/);
    expect(source).toContain('file: {filePath}');
    expect(source).toContain(': null}');
  });

  it('displays bridge text about UI-5 replacement', () => {
    expect(source).toContain('UI-5');
    expect(source).toContain('Cytoscape');
  });
});

describe('[AUD-TC-10-L1-07] query-provider.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'components/query-provider.tsx'), 'utf-8');
  });

  it('exports QueryProvider component', async () => {
    const mod = await import('../components/query-provider');
    expect(mod.QueryProvider).toBeDefined();
    expect(typeof mod.QueryProvider).toBe('function');
  });

  it('creates QueryClient with staleTime: 30_000', () => {
    expect(source).toMatch(/staleTime:\s*30[_,]?000/);
  });

  it('sets refetchOnWindowFocus: false', () => {
    expect(source).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it('wraps children in QueryClientProvider', () => {
    expect(source).toContain('QueryClientProvider');
    expect(source).toContain('{children}');
    expect(source).toContain("from '@tanstack/react-query'");
  });

  it('creates QueryClient only once via useState initializer', () => {
    expect(source).toContain('useState');
    // useState with initializer function pattern: useState(() => new QueryClient(...))
    expect(source).toMatch(/\[queryClient\]\s*=\s*useState\(\s*\(\)\s*=>/);
  });
});

describe('[AUD-TC-10-L1-08] RecentlyDestabilizedAlert.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'components/RecentlyDestabilizedAlert.tsx'), 'utf-8');
  });

  it('exports RecentlyDestabilizedAlert component', async () => {
    const mod = await import('../components/RecentlyDestabilizedAlert');
    expect(mod.RecentlyDestabilizedAlert).toBeDefined();
    expect(typeof mod.RecentlyDestabilizedAlert).toBe('function');
  });

  it('returns null when data is empty or falsy', () => {
    expect(source).toMatch(/if\s*\(!data\s*\|\|\s*data\.length\s*===\s*0\)\s*return\s*null/);
  });

  it('displays count of destabilized nodes in header ("N new CRITICAL nodes")', () => {
    expect(source).toContain('{data.length}');
    expect(source).toContain('new CRITICAL nodes');
  });

  it('shows up to 5 items via slice(0, 5)', () => {
    expect(source).toContain('data.slice(0, 5)');
  });

  it('has shortPath function extracting last 3 path segments', () => {
    expect(source).toContain('function shortPath');
    expect(source).toContain("split('/')");
    expect(source).toContain('slice(-3)');
    expect(source).toContain("join('/')");
  });

  it('items are clickable when onRowClick provided (cursor-pointer class)', () => {
    expect(source).toContain('cursor-pointer');
    expect(source).toContain('onRowClick?.(row)');
  });

  it('uses red-themed alert container (red-950 bg, red-800 border)', () => {
    expect(source).toContain('bg-red-950/40');
    expect(source).toContain('border-red-800/60');
  });
});

describe('[AUD-TC-10-L1-15] explorer/page.tsx', () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(join(UI_SRC, 'app/explorer/page.tsx'), 'utf-8');
  });

  it('exports ExplorerPage as default', async () => {
    const mod = await import('../app/explorer/page');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('lazy-loads ExplorerGraph via React.lazy', () => {
    expect(source).toContain('React.lazy');
    expect(source).toContain("import('@/components/ExplorerGraph')");
  });

  it('wraps lazy component in Suspense with GraphSkeleton fallback', () => {
    expect(source).toContain('Suspense');
    expect(source).toContain('GraphSkeleton');
    expect(source).toContain('fallback={<GraphSkeleton />}');
    expect(source).toContain("from '@/components/ui/loading-skeleton'");
  });

  it('renders heading "Graph Explorer"', () => {
    expect(source).toContain('Graph Explorer');
    expect(source).toContain('text-2xl');
    expect(source).toContain('font-bold');
  });
});
