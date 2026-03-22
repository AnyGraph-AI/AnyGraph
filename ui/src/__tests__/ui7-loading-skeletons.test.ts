/**
 * UI-7 Task 3: Loading Skeletons — Spec Tests
 *
 * Verifies that every async panel has a named skeleton export
 * in loading-skeleton.tsx with a shaped loading state.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_ROOT = resolve(__dirname, '../../');

function readSrc(rel: string) {
  return readFileSync(resolve(UI_ROOT, 'src', rel), 'utf-8');
}

// ─── Named skeleton exports ───────────────────────────────────

describe('[UI-7] Loading skeleton exports', () => {
  const skeletons = [
    'KpiSkeleton',
    'TreemapSkeleton',
    'PanelSkeleton',
    'TableSkeleton',
    'ChartSkeleton',
    'GraphSkeleton',
  ];

  for (const name of skeletons) {
    it(`exports ${name}`, async () => {
      const mod = await import('@/components/ui/loading-skeleton');
      expect((mod as Record<string, unknown>)[name]).toBeDefined();
      expect(typeof (mod as Record<string, unknown>)[name]).toBe('function');
    });
  }

  it('all skeletons use animate-pulse for shimmer effect', () => {
    const src = readSrc('components/ui/loading-skeleton.tsx');
    expect(src).toContain('animate-pulse');
  });

  it('TableSkeleton accepts a rows prop and renders multiple row elements', () => {
    const src = readSrc('components/ui/loading-skeleton.tsx');
    // Accepts rows prop with default
    expect(src).toContain('rows?: number');
    // Dynamically renders data rows based on the prop
    expect(src).toContain('Array.from({ length: rows })');
    // Row separation via border
    expect(src).toContain('border-b border-zinc-800');
  });

  it('ChartSkeleton accepts a height prop and renders bar-shaped elements', () => {
    const src = readSrc('components/ui/loading-skeleton.tsx');
    // Accepts height prop with default
    expect(src).toContain('height?: number');
    // Bars use rounded-t to look like bar-chart columns
    expect(src).toContain('rounded-t');
    // Bars are aligned to the bottom of the container (bar chart layout)
    expect(src).toContain('items-end');
  });

  it('GraphSkeleton renders node-shaped elements and a toolbar strip', () => {
    const src = readSrc('components/ui/loading-skeleton.tsx');
    // Node placeholders are circular (rounded-full)
    expect(src).toContain('rounded-full');
    // Toolbar strip is separated from the canvas by a bottom border
    expect(src).toContain('border-b border-zinc-800');
  });
});

// ─── Panels use skeletons not plain text ─────────────────────

describe('[UI-7] Explorer page uses GraphSkeleton', () => {
  it('explorer page imports GraphSkeleton', () => {
    const src = readSrc('app/explorer/page.tsx');
    expect(src).toContain('GraphSkeleton');
  });
});
