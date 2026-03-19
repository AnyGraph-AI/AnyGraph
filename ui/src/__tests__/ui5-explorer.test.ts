import { describe, expect, it } from 'vitest';

describe('[UI-5] Explorer APIs and wiring', () => {
  it('creates neighbors/danger-paths/default API routes', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const subgraphPath = path.resolve(
      import.meta.dirname,
      '..',
      'app',
      'api',
      'graph',
      'subgraph',
      '[nodeId]',
      'route.ts',
    );
    const dangerPath = path.resolve(
      import.meta.dirname,
      '..',
      'app',
      'api',
      'graph',
      'danger-paths',
      '[nodeId]',
      'route.ts',
    );
    const defaultPath = path.resolve(
      import.meta.dirname,
      '..',
      'app',
      'api',
      'graph',
      'explorer-default',
      'route.ts',
    );

    const subgraphExists = await fs.access(subgraphPath).then(() => true).catch(() => false);
    const dangerExists = await fs.access(dangerPath).then(() => true).catch(() => false);
    const defaultExists = await fs.access(defaultPath).then(() => true).catch(() => false);

    expect(subgraphExists).toBe(true);
    expect(dangerExists).toBe(true);
    expect(defaultExists).toBe(true);

    const subgraphSource = await fs.readFile(subgraphPath, 'utf-8');
    const dangerSource = await fs.readFile(dangerPath, 'utf-8');
    const defaultSource = await fs.readFile(defaultPath, 'utf-8');

    expect(subgraphSource).toContain('apiNodeCap');
    expect(subgraphSource).toContain('rootId');
    expect(dangerSource).toContain("mode: 'danger-paths'");
    expect(dangerSource).toContain('CALLS');
    expect(defaultSource).toContain('MATCH (sf:SourceFile');
    expect(defaultSource).toContain('adjustedPain');
  });

  it('uses Cytoscape explorer component on /explorer page', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const explorerPagePath = path.resolve(import.meta.dirname, '..', 'app', 'explorer', 'page.tsx');
    const explorerGraphPath = path.resolve(import.meta.dirname, '..', 'components', 'ExplorerGraph.tsx');

    const explorerPageSource = await fs.readFile(explorerPagePath, 'utf-8');
    const explorerGraphSource = await fs.readFile(explorerGraphPath, 'utf-8');

    expect(explorerPageSource).toContain('ExplorerGraph');
    expect(explorerGraphSource).toContain('cytoscape-cola');
    expect(explorerGraphSource).toContain('double-click');
    expect(explorerGraphSource).toContain('Collapse LOW/MEDIUM nodes');
    expect(explorerGraphSource).toContain('Explorer is waiting for a node focus.');
    expect(explorerGraphSource).toContain('/api/graph/explorer-default');
  });

  it('wires dashboard panels to explorer links', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const heroPath = path.resolve(import.meta.dirname, '..', 'components', 'HeroTreemap.tsx');
    const contextPath = path.resolve(import.meta.dirname, '..', 'components', 'ContextTabs.tsx');

    const pageSource = await fs.readFile(pagePath, 'utf-8');
    const heroSource = await fs.readFile(heroPath, 'utf-8');
    const contextSource = await fs.readFile(contextPath, 'utf-8');

    expect(pageSource).toContain('router.push(`/explorer?${search.toString()}`)');
    expect(pageSource).toContain('onNavigateToExplorer={openExplorer}');
    expect(pageSource).toContain('onFragilityClick');
    expect(pageSource).toContain('onSafestClick');

    expect(heroSource).toContain('onNavigateToExplorer');
    expect(heroSource).toContain('onCellClick');
    expect(contextSource).toContain('onFragilityClick');
    expect(contextSource).toContain('onSafestClick');
  });
});
