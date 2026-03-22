/**
 * UI-7 Task 1: Virtualization — Spec Tests
 *
 * Verifies:
 * 1. @tanstack/react-virtual is listed as a dependency
 * 2. GodFilesTable accepts a containerHeight prop for virtualization
 * 3. FragilityTable accepts a containerHeight prop for virtualization
 * 4. ExplorerGraph is lazy-loaded (React.lazy) in the explorer page
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const UI_ROOT = resolve(__dirname, '../../');

function readSrc(rel: string) {
  return readFileSync(resolve(UI_ROOT, 'src', rel), 'utf-8');
}

function readFile(abs: string) {
  return readFileSync(abs, 'utf-8');
}

// ─── @tanstack/react-virtual dependency ───────────────────────

describe('[UI-7] @tanstack/react-virtual dependency', () => {
  it('is listed in package.json dependencies', () => {
    const pkg = JSON.parse(readFile(resolve(UI_ROOT, 'package.json')));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(allDeps['@tanstack/react-virtual']).toBeDefined();
  });
});

// ─── GodFilesTable virtualization ────────────────────────────

describe('[UI-7] GodFilesTable virtualization', () => {
  it('exports GodFilesTable', async () => {
    const mod = await import('@/components/GodFilesTable');
    expect(mod.GodFilesTable).toBeDefined();
    expect(typeof mod.GodFilesTable).toBe('function');
  });

  it('imports useVirtualizer from @tanstack/react-virtual', () => {
    const src = readSrc('components/GodFilesTable.tsx');
    expect(src).toContain('@tanstack/react-virtual');
    expect(src).toContain('useVirtualizer');
  });

  it('has a containerHeight prop or virtualizer container div', () => {
    const src = readSrc('components/GodFilesTable.tsx');
    // Either containerHeight prop or a height/overflow style for the virtual scroller
    const hasVirtualContainer =
      src.includes('containerHeight') ||
      src.includes('overflow-y') ||
      src.includes('overflowY');
    expect(hasVirtualContainer).toBe(true);
  });
});

// ─── FragilityTable virtualization ───────────────────────────

describe('[UI-7] FragilityTable virtualization', () => {
  it('exports FragilityTable', async () => {
    const mod = await import('@/components/FragilityTable');
    expect(mod.FragilityTable).toBeDefined();
    expect(typeof mod.FragilityTable).toBe('function');
  });

  it('imports useVirtualizer from @tanstack/react-virtual', () => {
    const src = readSrc('components/FragilityTable.tsx');
    expect(src).toContain('@tanstack/react-virtual');
    expect(src).toContain('useVirtualizer');
  });

  it('has a virtualizer container with overflow scroll', () => {
    const src = readSrc('components/FragilityTable.tsx');
    const hasVirtualContainer =
      src.includes('containerHeight') ||
      src.includes('overflow-y') ||
      src.includes('overflowY');
    expect(hasVirtualContainer).toBe(true);
  });
});

// ─── ExplorerGraph lazy loading ───────────────────────────────

describe('[UI-7] ExplorerGraph lazy loading', () => {
  it('explorer page uses React.lazy for ExplorerGraph', () => {
    const src = readSrc('app/explorer/page.tsx');
    expect(src).toContain('React.lazy');
    expect(src).toContain('ExplorerGraph');
  });

  it('explorer page wraps ExplorerGraph in Suspense', () => {
    const src = readSrc('app/explorer/page.tsx');
    expect(src).toContain('Suspense');
  });

  it('explorer page uses a shaped skeleton fallback (not plain text)', () => {
    const src = readSrc('app/explorer/page.tsx');
    // Should import and use a proper skeleton, not just a string
    const hasProperFallback =
      src.includes('Skeleton') ||
      src.includes('skeleton') ||
      src.includes('animate-pulse');
    expect(hasProperFallback).toBe(true);
  });
});
