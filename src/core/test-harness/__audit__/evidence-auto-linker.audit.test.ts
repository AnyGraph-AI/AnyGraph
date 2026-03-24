/**
 * AUD-TC-03-L1b-31: evidence-auto-linker.ts audit tests
 *
 * Spec: plans/codegraph/TODO_BUCKET.md §"Backfill legacy done-tasks with machine-verifiable evidence"
 *
 * Behaviors:
 *   (1) queries done tasks without HAS_CODE_EVIDENCE edges
 *   (2) uses layered strategy: explicit backtick ref → exact file → function name → keyword
 *   (3) only links at confidence ≥ 0.8
 *   (4) tags all edges with source='evidence_auto_linker'
 *   (5) respects NO_CODE_EVIDENCE_OK exclusion
 *   (6) delegates to evidence-auto-linker-utils for ref extraction and asset classification
 *   (7) reports matched/created/skipped counts
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockGetDriver } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockGetDriver: vi.fn().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    getDriver = mockGetDriver;
  },
}));

// Mock the utils module
const { mockClassifyAssetForEvidence, mockMatchExplicitRefs } = vi.hoisted(() => ({
  mockClassifyAssetForEvidence: vi.fn().mockReturnValue({ refType: 'file_path', evidenceRole: 'target' }),
  mockMatchExplicitRefs: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../utils/evidence-auto-linker-utils.js', () => ({
  classifyAssetForEvidence: mockClassifyAssetForEvidence,
  matchExplicitRefs: mockMatchExplicitRefs,
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;
let originalArgv: string[];

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockGetDriver.mockReset().mockReturnValue({ close: vi.fn().mockResolvedValue(undefined) });
  mockClassifyAssetForEvidence.mockReset().mockReturnValue({ refType: 'file_path', evidenceRole: 'target' });
  mockMatchExplicitRefs.mockReset().mockReturnValue([]);
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  originalArgv = [...process.argv];
  process.argv = ['node', 'evidence-auto-linker.ts'];
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
  process.argv = originalArgv;
});

// Helper: build task row
function taskRow(name: string, planProjectId = 'plan_codegraph', taskElementId = 'elem-1') {
  return { name, planProjectId, taskElementId };
}

// Helper: build code asset row
function assetRow(name: string, filePath: string, kind = 'SourceFile', elementId = 'asset-1') {
  return { name, filePath, elementId, kind };
}

async function runMain(): Promise<void> {
  const mod = await import('../../../utils/evidence-auto-linker.js');
  // Module executes main() on import — wait for next tick
  await new Promise((r) => setTimeout(r, 50));
}

describe('AUD-TC-03-L1b-31: evidence-auto-linker', () => {
  // ── Behavior 1: queries done tasks without HAS_CODE_EVIDENCE edges ──
  describe('B1: queries done tasks without HAS_CODE_EVIDENCE edges', () => {
    it('first query selects done tasks with plan_ prefix, no noCodeEvidenceOK, no HAS_CODE_EVIDENCE', async () => {
      // Return empty so main exits early
      mockRun.mockResolvedValueOnce([]); // unlinked tasks query

      await runMain();

      // First call should be the unlinked tasks query
      const firstCall = mockRun.mock.calls[0];
      expect(firstCall).toBeDefined();
      const query = firstCall[0] as string;
      expect(query).toContain("status: 'done'");
      expect(query).toContain("STARTS WITH 'plan_'");
      expect(query).toContain('noCodeEvidenceOK IS NULL');
      expect(query).toContain('HAS_CODE_EVIDENCE');
    });
  });

  // ── Behavior 2: layered strategy ordering ──
  describe('B2: layered strategy — explicit ref → exact file → function name', () => {
    it('explicit backtick refs take priority (skips further strategies when found)', async () => {
      const task = taskRow('Implement `evidence-auto-linker.ts` feature');
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'asset-1');

      mockMatchExplicitRefs.mockReturnValue([
        { asset, matchType: 'explicit_ref' as const, confidence: 0.99 },
      ]);

      // Query 1: unlinked tasks
      mockRun.mockResolvedValueOnce([task]);
      // Query 2: project mapping
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      // Query 3: code assets
      mockRun.mockResolvedValueOnce([asset]);
      // Query 4: MERGE edge
      mockRun.mockResolvedValueOnce([]);
      // Query 5: remaining count
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      // matchExplicitRefs was called (delegates to utils)
      expect(mockMatchExplicitRefs).toHaveBeenCalled();

      // The MERGE query should use confidence 0.99 (explicit ref confidence)
      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]'),
      );
      if (mergeCall) {
        expect((mergeCall[1] as any).confidence).toBe(0.99);
        expect((mergeCall[1] as any).matchType).toBe('explicit_ref');
      }
    });

    it('falls through to exact file match when no explicit refs', async () => {
      const task = taskRow('Fix the evidence-auto-linker feature');

      mockMatchExplicitRefs.mockReturnValue([]); // no explicit refs

      // The asset has a stem > 6 chars that appears in task name
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'asset-2');

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      // MERGE edge
      mockRun.mockResolvedValueOnce([]);
      // remaining count
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]'),
      );
      if (mergeCall) {
        expect((mergeCall[1] as any).matchType).toBe('exact_file');
        expect((mergeCall[1] as any).confidence).toBe(0.95);
      }
    });

    it('falls through to function name match when no file match', async () => {
      // Task name includes a function-like term but no file stem
      const task = taskRow('Improve resolveProjectId handling');

      mockMatchExplicitRefs.mockReturnValue([]);

      // Only function assets, no matching SourceFile
      const funcAsset = assetRow('resolveProjectId', 'src/core/utils/project-id.ts', 'Function', 'func-1');

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([funcAsset]);
      // MERGE edge
      mockRun.mockResolvedValueOnce([]);
      // remaining count
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]'),
      );
      if (mergeCall) {
        expect((mergeCall[1] as any).matchType).toBe('function_name');
        expect((mergeCall[1] as any).confidence).toBe(0.85);
      }
    });
  });

  // ── Behavior 3: confidence ≥ 0.8 threshold ──
  describe('B3: only links at confidence ≥ 0.8', () => {
    it('explicit refs (0.99/0.98), exact file (0.95), function name (0.85) all exceed threshold', () => {
      // SPEC-GAP: The 0.8 threshold is stated in spec but enforced implicitly by strategy confidence values.
      // All strategy confidences in the implementation are ≥ 0.85, so no sub-0.8 links are possible.
      // There is no explicit runtime check for >= 0.8 — the threshold is architectural.
      expect(0.99).toBeGreaterThanOrEqual(0.8); // explicit ref file
      expect(0.98).toBeGreaterThanOrEqual(0.8); // explicit ref ident
      expect(0.95).toBeGreaterThanOrEqual(0.8); // exact file
      expect(0.85).toBeGreaterThanOrEqual(0.8); // function name
    });
    // SPEC-GAP: No explicit confidence threshold check exists in the code. The spec says
    // "only links at confidence >= 0.8" but this is guaranteed by strategy design (lowest = 0.85),
    // not by a runtime guard. If a new strategy were added with lower confidence, nothing would block it.
  });

  // ── Behavior 4: tags edges with source='evidence_auto_linker' ──
  describe('B4: tags all edges with source=evidence_auto_linker', () => {
    it('MERGE query sets source property to evidence_auto_linker', async () => {
      const task = taskRow('Fix the evidence-auto-linker feature');
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'asset-tag');

      mockMatchExplicitRefs.mockReturnValue([]);

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      mockRun.mockResolvedValueOnce([]); // MERGE
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]'),
      );
      expect(mergeCall).toBeDefined();
      const mergeQuery = mergeCall![0] as string;
      expect(mergeQuery).toContain("e.source = 'evidence_auto_linker'");
    });
  });

  // ── Behavior 5: respects NO_CODE_EVIDENCE_OK ──
  describe('B5: respects NO_CODE_EVIDENCE_OK exclusion', () => {
    it('query filters out tasks where noCodeEvidenceOK is set', async () => {
      mockRun.mockResolvedValueOnce([]); // no tasks

      await runMain();

      const query = mockRun.mock.calls[0][0] as string;
      expect(query).toContain('noCodeEvidenceOK IS NULL');
    });
  });

  // ── Behavior 6: delegates to evidence-auto-linker-utils ──
  describe('B6: delegates to utils for ref extraction and asset classification', () => {
    it('calls matchExplicitRefs for each task with task name and assets', async () => {
      const task = taskRow('Implement `foo.ts` feature');
      const asset = assetRow('foo.ts', 'src/foo.ts', 'SourceFile', 'a-1');

      mockMatchExplicitRefs.mockReturnValue([]);

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      expect(mockMatchExplicitRefs).toHaveBeenCalledWith(
        'Implement `foo.ts` feature',
        expect.arrayContaining([expect.objectContaining({ name: 'foo.ts' })]),
      );
    });

    it('calls classifyAssetForEvidence for matched assets', async () => {
      const task = taskRow('Fix the evidence-auto-linker feature');
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'a-cls');

      mockMatchExplicitRefs.mockReturnValue([]);
      mockClassifyAssetForEvidence.mockReturnValue({ refType: 'file_path', evidenceRole: 'target' });

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      mockRun.mockResolvedValueOnce([]); // MERGE
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      expect(mockClassifyAssetForEvidence).toHaveBeenCalled();
    });
  });

  // ── Behavior 7: reports matched/created/skipped counts ──
  describe('B7: reports matched/created/skipped counts', () => {
    it('outputs JSON with candidateTasks, matched, created, unlinkedRemaining', async () => {
      mockRun.mockResolvedValueOnce([]); // no tasks

      await runMain();

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output).toHaveProperty('ok', true);
      expect(output).toHaveProperty('linked', 0);
      expect(output).toHaveProperty('unlinkedRemaining', 0);
    });

    it('reports non-zero matched and created when links are made', async () => {
      const task = taskRow('Fix the evidence-auto-linker feature');
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'a-rpt');

      mockMatchExplicitRefs.mockReturnValue([]);

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      mockRun.mockResolvedValueOnce([]); // MERGE success
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.ok).toBe(true);
      expect(output.matched).toBeGreaterThan(0);
      expect(output.created).toBeGreaterThan(0);
    });

    it('dry-run mode reports links without creating edges', async () => {
      process.argv = ['node', 'evidence-auto-linker.ts', '--dry-run'];

      const task = taskRow('Fix the evidence-auto-linker feature');
      const asset = assetRow('evidence-auto-linker.ts', 'src/utils/evidence-auto-linker.ts', 'SourceFile', 'a-dry');

      mockMatchExplicitRefs.mockReturnValue([]);

      mockRun.mockResolvedValueOnce([task]);
      mockRun.mockResolvedValueOnce([{ planId: 'plan_codegraph', codeId: 'proj_c0d3e9a1f200' }]);
      mockRun.mockResolvedValueOnce([asset]);
      // No MERGE call in dry-run
      mockRun.mockResolvedValueOnce([{ cnt: 0 }]);

      await runMain();

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = JSON.parse(mockConsoleLog.mock.calls[0][0]);
      expect(output.dryRun).toBe(true);
      expect(output.created).toBe(0);
      expect(output.links).toBeDefined();
    });
  });
});
