/**
 * UI-6 Task 6 — deep links across major view states
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('[UI-6] deep link coverage', () => {
  it('navbar links include deep-link targets for explorer/diagnosis/gaps/fragility', async () => {
    const navbarPath = path.resolve(import.meta.dirname, '..', 'components', 'navbar.tsx');
    const source = await readFile(navbarPath, 'utf8');

    expect(source).toContain("/explorer?mode=neighbors");
    expect(source).toContain("/diagnosis?tab=diagnosis");
    expect(source).toContain('/?view=gaps');
    expect(source).toContain('/?view=fragility');
  });

  it('diagnosis page supports tab deep-link parsing + URL sync', async () => {
    const diagnosisPath = path.resolve(import.meta.dirname, '..', 'app', 'diagnosis', 'page.tsx');
    const source = await readFile(diagnosisPath, 'utf8');

    expect(source).toContain('function parseTab');
    expect(source).toContain("params.set('tab', next)");
    expect(source).toContain('window.history.replaceState');
    expect(source).toContain('router.replace(nextUrl)');
  });

  it('explorer graph supports mode deep-link parsing + URL sync', async () => {
    const explorerPath = path.resolve(import.meta.dirname, '..', 'components', 'ExplorerGraph.tsx');
    const source = await readFile(explorerPath, 'utf8');

    expect(source).toContain('function parseMode');
    expect(source).toContain("parseMode(params.get('mode'))");
    expect(source).toContain("next.set('mode', m)");
    expect(source).toContain("window.history.replaceState({}, '', `/explorer?${next.toString()}`)");
  });

  it('dashboard supports view deep links for gaps/fragility sections', async () => {
    const pagePath = path.resolve(import.meta.dirname, '..', 'app', 'page.tsx');
    const source = await readFile(pagePath, 'utf8');

    expect(source).toContain("type DashboardView = 'dashboard' | 'gaps' | 'fragility'");
    expect(source).toContain("params.get('view')");
    expect(source).toContain("id=\"gaps-view\"");
    expect(source).toContain("id=\"fragility-view\"");
    expect(source).toContain("setFilter({ view: e.target.value })");
    expect(source).toContain('scrollIntoView');
  });
});
