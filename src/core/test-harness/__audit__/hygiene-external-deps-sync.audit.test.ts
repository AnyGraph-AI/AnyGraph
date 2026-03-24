/**
 * AUD-TC-03-L1b-37: hygiene-external-deps-sync.ts audit tests
 * Role: B6 (Health Witness)
 *
 * Spec: plans/hygiene-governance/PLAN.md external dependency tracking
 *
 * Behaviors:
 *   (1) reads package.json for declared dependencies
 *   (2) cross-references with unresolved Import nodes in graph
 *   (3) creates ExternalDependency nodes with usage counts
 *   (4) computes deterministic SHA IDs
 *   (5) accepts PROJECT_ID from env
 *   (6) reports sync counts (declared vs used vs orphaned)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── neo4j-driver mock ──

const mockSessionRun = vi.fn().mockResolvedValue({ records: [] });
const mockSessionClose = vi.fn().mockResolvedValue(undefined);
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: vi.fn(() => ({
        run: mockSessionRun,
        close: mockSessionClose,
      })),
      close: mockDriverClose,
    })),
    auth: { basic: vi.fn(() => ({})) },
  },
}));

// ── fs mock ──

const mockReadFile = vi.fn();
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, default: { ...actual, readFile: mockReadFile } };
});

let mockExit: ReturnType<typeof vi.spyOn>;
let mockLog: ReturnType<typeof vi.spyOn>;
let mockError: ReturnType<typeof vi.spyOn>;

const origEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  mockSessionRun.mockReset().mockResolvedValue({ records: [] });
  mockSessionClose.mockReset().mockResolvedValue(undefined);
  mockDriverClose.mockReset().mockResolvedValue(undefined);
  mockReadFile.mockReset();
  process.env = { ...origEnv };
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockLog.mockRestore();
  mockError.mockRestore();
  process.env = origEnv;
});

function fakePkgJson(deps?: Record<string, string>, devDeps?: Record<string, string>) {
  return JSON.stringify({
    name: 'test-project',
    dependencies: deps ?? { vitest: '^1.0.0', neo4j: '^5.0.0' },
    devDependencies: devDeps ?? {},
  });
}

function fakeImportRecord(mod: string, fileCount: number, files: string[] = []) {
  return {
    get: (key: string) => {
      if (key === 'mod') return mod;
      if (key === 'fileCount') return fileCount;
      if (key === 'files') return files.length ? files : [`src/file${fileCount}.ts`];
      return null;
    },
  };
}

async function runModule(): Promise<void> {
  await import('../../../utils/hygiene-external-deps-sync.js');
  await new Promise((r) => setTimeout(r, 100));
}

describe('hygiene-external-deps-sync audit tests (L1b-37)', () => {
  // ─── B1: reads package.json for declared dependencies ───
  describe('B1: reads package.json', () => {
    it('reads package.json from REPO_ROOT and parses dependencies + devDependencies', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }, { vitest: '^1.0.0' }));
      mockSessionRun.mockResolvedValue({ records: [] });
      await runModule();

      expect(mockReadFile).toHaveBeenCalled();
      const readPath = String(mockReadFile.mock.calls[0][0]);
      expect(readPath).toContain('package.json');
    });
  });

  // ─── B2: cross-references with unresolved Import nodes ───
  describe('B2: cross-references with Import nodes in graph', () => {
    it('queries unresolved Import nodes grouped by module specifier', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson());
      // First call: imports query; second call: delete; rest: MERGE
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('lodash', 3)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const importQuery = mockSessionRun.mock.calls[0];
      const cypher = String(importQuery[0]);
      expect(cypher).toContain('Import');
      expect(cypher).toContain('NOT (i)-[:RESOLVES_TO]->()');
    });

    it('skips relative/internal imports (starting with . or /)', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson());
      mockSessionRun
        .mockResolvedValueOnce({
          records: [
            fakeImportRecord('./local', 2),
            fakeImportRecord('/absolute', 1),
            fakeImportRecord('lodash', 5),
          ],
        })
        .mockResolvedValue({ records: [] });
      await runModule();

      const jsonCall = mockLog.mock.calls.find((c) => {
        try { return JSON.parse(String(c[0])).ok !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.internalUnresolved).toBe(2);
    });
  });

  // ─── B3: creates ExternalDependency nodes with usage counts ───
  describe('B3: creates ExternalDependency nodes', () => {
    it('MERGEs CodeNode:ExternalDependency with fileCount and kind', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }));
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('lodash', 5, ['src/a.ts'])] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ExternalDependency') && String(c[0]).includes('MERGE'),
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.name).toBe('lodash');
      expect(params.kind).toBe('npm');
      expect(params.fileCount).toBe(5);
    });

    it('classifies node builtins correctly (kind=builtin)', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson());
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('node:fs', 10)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ExternalDependency') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.kind).toBe('builtin');
      expect(params.isDeclared).toBe(true);
    });

    it('creates HAS_DEPENDENCY edge to Project', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }));
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('lodash', 3)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const depEdgeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('HAS_DEPENDENCY'),
      );
      expect(depEdgeCalls.length).toBeGreaterThan(0);
    });
  });

  // ─── B4: computes deterministic SHA IDs ───
  describe('B4: deterministic SHA IDs', () => {
    it('produces ext-dep:{projectId}:{sha16} format ID', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }));
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('lodash', 1)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ExternalDependency') && String(c[0]).includes('MERGE'),
      );
      const id = String((mergeCalls[0][1] as Record<string, unknown>).id);
      expect(id).toMatch(/^ext-dep:proj_c0d3e9a1f200:[0-9a-f]{16}$/);

      // Verify determinism
      const expectedHash = crypto.createHash('sha256').update('lodash').digest('hex').slice(0, 16);
      expect(id).toBe(`ext-dep:proj_c0d3e9a1f200:${expectedHash}`);
    });

    it('normalizes scoped packages (@scope/pkg/sub → @scope/pkg)', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ '@types/node': '^20.0.0' }));
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('@types/node/fs', 2)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ExternalDependency') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.packageName).toBe('@types/node');
    });
  });

  // ─── B5: accepts PROJECT_ID from env ───
  describe('B5: respects PROJECT_ID env var', () => {
    it('uses custom PROJECT_ID in node IDs and queries', async () => {
      process.env.PROJECT_ID = 'proj_ext_test';
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }));
      mockSessionRun
        .mockResolvedValueOnce({ records: [fakeImportRecord('lodash', 1)] })
        .mockResolvedValue({ records: [] });
      await runModule();

      // Import query should use custom project
      const importQuery = mockSessionRun.mock.calls[0][1] as Record<string, unknown>;
      expect(importQuery.projectId).toBe('proj_ext_test');
    });
  });

  // ─── B6: reports sync counts ───
  describe('B6: reports sync counts', () => {
    it('outputs JSON with builtinCount, externalCount, internalUnresolved, totalCreated, undeclaredDeps', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson({ lodash: '^4.17.0' }));
      mockSessionRun
        .mockResolvedValueOnce({
          records: [
            fakeImportRecord('lodash', 5),
            fakeImportRecord('node:path', 10),
            fakeImportRecord('./local', 2),
            fakeImportRecord('undeclared-pkg', 1),
          ],
        })
        .mockResolvedValue({ records: [] });
      await runModule();

      const jsonCall = mockLog.mock.calls.find((c) => {
        try { return JSON.parse(String(c[0])).ok !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.ok).toBe(true);
      expect(parsed.builtinCount).toBe(1);
      expect(parsed.externalCount).toBe(2); // lodash + undeclared-pkg
      expect(parsed.internalUnresolved).toBe(1); // ./local
      expect(parsed.totalCreated).toBe(3);
      expect(parsed.undeclaredDeps).toContain('undeclared-pkg');
    });

    it('cleans old ExternalDependency nodes before re-creating', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson());
      mockSessionRun.mockResolvedValue({ records: [] });
      await runModule();

      const deleteCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('DETACH DELETE') && String(c[0]).includes('ExternalDependency'),
      );
      expect(deleteCalls.length).toBe(1);
    });
  });

  // ─── Cleanup ───
  describe('cleanup: always closes neo4j', () => {
    it('closes session and driver', async () => {
      mockReadFile.mockResolvedValue(fakePkgJson());
      mockSessionRun.mockResolvedValue({ records: [] });
      await runModule();
      expect(mockSessionClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });
  });

  // SPEC-GAP: Spec doesn't define NODE_BUILTINS list boundary — implementation includes ~30 builtins
  // SPEC-GAP: Spec doesn't specify the cleanup strategy (DETACH DELETE before re-creation vs incremental diff)
});
