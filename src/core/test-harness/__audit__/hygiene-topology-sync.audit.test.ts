/**
 * AUD-TC-03-L1b-43: hygiene-topology-sync.ts audit tests
 * Role: B6 (Health Witness)
 *
 * Spec: plans/hygiene-governance/PLAN.md topology management
 *
 * Behaviors:
 *   (1) defines PATH_CLASSES (source/tests/docs/scripts/ops) with glob patterns
 *   (2) creates TopologyManifest node in Neo4j
 *   (3) classifies files by path patterns
 *   (4) uses direct neo4j-driver
 *   (5) accepts PROJECT_ID from env
 *   (6) TOPOLOGY_VERSION = 'v1'
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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

let mockExit: ReturnType<typeof vi.spyOn>;
let mockLog: ReturnType<typeof vi.spyOn>;
let mockError: ReturnType<typeof vi.spyOn>;

const origEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  mockSessionRun.mockReset().mockResolvedValue({ records: [] });
  mockSessionClose.mockReset().mockResolvedValue(undefined);
  mockDriverClose.mockReset().mockResolvedValue(undefined);
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

async function runModule(): Promise<void> {
  await import('../../../utils/hygiene-topology-sync.js');
  await new Promise((r) => setTimeout(r, 100));
}

describe('hygiene-topology-sync audit tests (L1b-43)', () => {
  // ─── B1: defines PATH_CLASSES with expected keys ───
  describe('B1: PATH_CLASSES with glob patterns', () => {
    it('includes source, tests, docs, scripts, and ops path classes', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const keys = params.pathClassKeys as string[];
      expect(keys).toContain('source');
      expect(keys).toContain('tests');
      expect(keys).toContain('docs');
      expect(keys).toContain('scripts');
      expect(keys).toContain('ops');
    });

    it('also includes artifacts, generated, and third_party classes', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const keys = params.pathClassKeys as string[];
      expect(keys).toContain('artifacts');
      expect(keys).toContain('generated');
      expect(keys).toContain('third_party');
      expect(keys).toHaveLength(8);
    });

    it('stores pathClassesJson with patterns per class', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const parsed = JSON.parse(params.pathClassesJson as string);
      expect(Array.isArray(parsed)).toBe(true);

      const sourceClass = parsed.find((p: any) => p.key === 'source');
      expect(sourceClass.patterns).toContain('src/**');

      const testsClass = parsed.find((p: any) => p.key === 'tests');
      expect(testsClass.patterns).toContain('test/**');
      expect(testsClass.patterns).toContain('**/*.test.ts');
    });
  });

  // ─── B2: creates TopologyManifest node ───
  describe('B2: creates TopologyManifest node in Neo4j', () => {
    it('uses MERGE with CodeNode:TopologyManifest labels', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const cypher = String(mergeCalls[0][0]);
      expect(cypher).toContain('CodeNode:TopologyManifest');
    });

    it('deletes prior TopologyManifest before re-creating', async () => {
      await runModule();

      const deleteCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('DETACH DELETE'),
      );
      expect(deleteCalls.length).toBe(1);
    });

    it('links to RepoHygieneProfile via DEFINES_TOPOLOGY edge', async () => {
      await runModule();

      const profileCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) =>
          String(c[0]).includes('DEFINES_TOPOLOGY') &&
          String(c[0]).includes('RepoHygieneProfile'),
      );
      expect(profileCalls.length).toBeGreaterThan(0);
    });

    it('links to HygieneDomain via DEFINES_TOPOLOGY edge', async () => {
      await runModule();

      const domainCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) =>
          String(c[0]).includes('DEFINES_TOPOLOGY') &&
          String(c[0]).includes('HygieneDomain'),
      );
      expect(domainCalls.length).toBeGreaterThan(0);
    });

    it('sets allowedExtensions, forbiddenPatterns, deprecatedPatterns', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(Array.isArray(params.allowedExtensions)).toBe(true);
      expect((params.allowedExtensions as string[])).toContain('.ts');
      expect(Array.isArray(params.forbiddenPatterns)).toBe(true);
      expect((params.forbiddenPatterns as string[])).toContain('**/.DS_Store');
      expect(Array.isArray(params.deprecatedPatterns)).toBe(true);
    });
  });

  // ─── B3: classifies files by path patterns ───
  describe('B3: path classification via pathClassesJson', () => {
    it('source class uses src/** pattern', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const classes = JSON.parse(params.pathClassesJson as string);
      const source = classes.find((c: any) => c.key === 'source');
      expect(source.patterns).toContain('src/**');
    });

    it('ops class uses .github/** and config/** patterns', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const classes = JSON.parse(params.pathClassesJson as string);
      const ops = classes.find((c: any) => c.key === 'ops');
      expect(ops.patterns).toContain('.github/**');
      expect(ops.patterns).toContain('config/**');
    });
  });

  // ─── B4: uses direct neo4j-driver ───
  describe('B4: uses direct neo4j-driver', () => {
    it('closes session and driver in finally block', async () => {
      await runModule();
      expect(mockSessionClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });
  });

  // ─── B5: accepts PROJECT_ID from env ───
  describe('B5: accepts PROJECT_ID from env', () => {
    it('uses custom PROJECT_ID in manifest ID and params', async () => {
      process.env.PROJECT_ID = 'proj_topo_test';
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_topo_test');
      expect(String(params.id)).toContain('proj_topo_test');
    });

    it('respects HYGIENE_MAX_PATH_LENGTH env var', async () => {
      process.env.HYGIENE_MAX_PATH_LENGTH = '256';
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.maxPathLength).toBe(256);
    });
  });

  // ─── B6: TOPOLOGY_VERSION = 'v1' ───
  describe('B6: TOPOLOGY_VERSION is v1', () => {
    it('sets version to v1 on TopologyManifest node', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('TopologyManifest') && String(c[0]).includes('MERGE'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.version).toBe('v1');
    });

    it('outputs JSON with topologyVersion=v1', async () => {
      await runModule();

      const jsonCall = mockLog.mock.calls.find((c) => {
        try { return JSON.parse(String(c[0])).ok !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.ok).toBe(true);
      expect(parsed.topologyVersion).toBe('v1');
      expect(parsed.pathClassCount).toBe(8);
    });
  });

  // SPEC-GAP: Spec mentions "TopologyProfile" but implementation creates "TopologyManifest" — naming divergence
  // SPEC-GAP: Spec doesn't define maxPathLength or maxSourceFileBytes defaults (180 and 1048576 are implementation choices)
  // SPEC-GAP: Spec doesn't specify that prior manifests should be DETACH DELETE'd before re-creation
});
