/**
 * UI-4: Diagnosis API Route — Unit Tests
 *
 * Tests the GET handler for /api/graph/diagnosis.
 * Mocks runDiagnosis to avoid Neo4j dependency.
 *
 * Bug fix coverage: closeDriver() was being called after every request,
 * killing the Neo4j connection pool. Removed in fix (2026-03-20).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const { runDiagnosisMock } = vi.hoisted(() => ({
  runDiagnosisMock: vi.fn(),
}));

// Mock the self-diagnosis module that the route imports.
// The route uses a deep relative import; vitest resolves mocks by resolved path,
// so we use the absolute module path that the route's relative import resolves to.
vi.mock('/home/jonathan/.openclaw/workspace/codegraph/src/scripts/entry/self-diagnosis', () => ({
  runDiagnosis: runDiagnosisMock,
  closeDriver: vi.fn(),
}));

import { GET } from '@/app/api/graph/diagnosis/route';

describe('[UI-4] Diagnosis API route handler', () => {
  beforeEach(() => {
    runDiagnosisMock.mockReset();
  });

  it('returns diagnosis results as JSON with data key', async () => {
    const mockResults = [
      { id: 'D1', question: 'Does the graph track blind spots?', answer: 'Yes', healthy: true },
      { id: 'D2', question: 'Coverage match reality?', answer: '346/408', healthy: true },
    ];
    runDiagnosisMock.mockResolvedValueOnce(mockResults);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('data');
    expect(body.data).toEqual(mockResults);
    expect(runDiagnosisMock).toHaveBeenCalledOnce();
  });

  it('returns 500 with error message when runDiagnosis throws', async () => {
    runDiagnosisMock.mockRejectedValueOnce(new Error('Neo4j connection failed'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toHaveProperty('error', 'Diagnosis failed');
    expect(body).toHaveProperty('message');
    expect(body.message).toContain('Neo4j connection failed');
  });

  it('returns empty data array when diagnosis returns empty', async () => {
    runDiagnosisMock.mockResolvedValueOnce([]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it('does NOT import or call closeDriver (pool leak prevention)', async () => {
    const fs = await import('node:fs/promises');
    const routePath = path.resolve(
      import.meta.dirname, '..', 'app', 'api', 'graph', 'diagnosis', 'route.ts'
    );
    const source = await fs.readFile(routePath, 'utf-8');

    // Strip comments to only check executable code
    const codeOnly = source
      .replace(/\/\/.*$/gm, '')       // single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments

    // closeDriver should not be imported or called in executable code
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*closeDriver[^}]*\}/);
    expect(codeOnly).not.toMatch(/closeDriver\s*\(/);
  });
});
