/**
 * AUD-TC-11c-L2-03: ground-truth/cli.ts — Supplementary Audit Tests
 *
 * CRITICAL function. Existing coverage: printOutput no-throw only (INCOMPLETE).
 * Gaps: arg parsing, runtime wiring, output rendering, error exit, cleanup.
 *
 * Strategy: Test main() and printOutput() with controlled mocks.
 * We mock Neo4jService, GroundTruthRuntime, and SoftwareGovernancePack
 * to test CLI orchestration in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────

const mockClose = vi.fn().mockResolvedValue(undefined);
const mockRuntimeRun = vi.fn().mockResolvedValue({
  panel1: {
    planStatus: [],
    governanceHealth: [],
    evidenceCoverage: [],
    temporalConfidence: [],
    contradictions: [],
    openHypotheses: [],
    relevantClaims: [],
    integrity: {
      core: [],
      domain: [],
      summary: { totalChecks: 0, passed: 0, failed: 0, criticalFailures: 0 },
    },
  },
  panel2: {
    agentId: 'watson',
    status: 'IDLE',
    currentTaskId: null,
    currentMilestone: null,
    sessionBookmark: null,
    briefing: null,
  },
  panel3: { deltas: [], transitiveImpact: [], candidateModifies: [] },
  meta: {
    projectId: 'proj_test',
    depth: 'medium',
    durationMs: 42,
    runAt: new Date().toISOString(),
  },
});

vi.mock('../../../storage/neo4j/neo4j.service.js', () => {
  const MockNeo4j = vi.fn(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
    this.run = vi.fn().mockResolvedValue([]);
  });
  return { Neo4jService: MockNeo4j };
});

// Shared ref so tests can control the mock runtime's behavior
const runtimeRunRef = { fn: null as any };

vi.mock('../../ground-truth/runtime.js', () => {
  const MockRuntime = vi.fn(function (this: any) {
    this.run = (...args: any[]) => runtimeRunRef.fn(...args);
    this.close = vi.fn();
  });
  return { GroundTruthRuntime: MockRuntime };
});

vi.mock('../../ground-truth/packs/software.js', () => {
  const MockPack = vi.fn(function (this: any) {
    this.domain = 'software-governance';
    this.version = '1.0.0';
  });
  return { SoftwareGovernancePack: MockPack };
});

vi.mock('../../ground-truth/delta.js', () => ({
  generateRecoveryAppendix: vi.fn().mockReturnValue([]),
}));

import { main, printOutput } from '../../ground-truth/cli.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';
import { GroundTruthRuntime } from '../../ground-truth/runtime.js';
import { SoftwareGovernancePack } from '../../ground-truth/packs/software.js';

const ORIGINAL_ARGV = [...process.argv];

describe('AUD-TC-11c-L2-03: ground-truth/cli.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = ['node', 'ground-truth'];
    runtimeRunRef.fn = mockRuntimeRun;
    mockRuntimeRun.mockClear();
  });

  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
  });

  // ─── Behavior 1: CLI argument parsing ───────────────────────────

  describe('B1: CLI accepts --project, --agent, --depth arguments', () => {
    it('defaults projectId to proj_c0d3e9a1f200 when no --project', async () => {
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj_c0d3e9a1f200' }),
      );
    });

    it('uses --project value when provided', async () => {
      process.argv = ['node', 'ground-truth', '--project', 'proj_custom'];
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'proj_custom' }),
      );
    });

    it('defaults depth to medium when no --depth', async () => {
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ depth: 'medium' }),
      );
    });

    it('maps --depth full to heavy tier', async () => {
      process.argv = ['node', 'ground-truth', '--depth', 'full'];
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ depth: 'heavy' }),
      );
    });

    it('passes --agent value as agentId', async () => {
      process.argv = ['node', 'ground-truth', '--agent', 'codex-1'];
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'codex-1' }),
      );
    });

    it('agentId is undefined when no --agent', async () => {
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: undefined }),
      );
    });
  });

  // ─── Behavior 2: Creates runtime with SoftwareGovernancePack ────

  describe('B2: Creates GroundTruthRuntime with SoftwareGovernancePack', () => {
    it('instantiates Neo4jService', async () => {
      await main();
      expect(Neo4jService).toHaveBeenCalledTimes(1);
    });

    it('passes Neo4j to SoftwareGovernancePack', async () => {
      await main();
      expect(SoftwareGovernancePack).toHaveBeenCalledTimes(1);
    });

    it('passes pack and Neo4j to GroundTruthRuntime', async () => {
      await main();
      expect(GroundTruthRuntime).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Behavior 3: Runs full cycle ───────────────────────────────

  describe('B3: Runs full ground truth cycle', () => {
    it('calls runtime.run() exactly once', async () => {
      await main();
      expect(mockRuntimeRun).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Behavior 4: Output rendering ──────────────────────────────

  describe('B4: Outputs human-readable format', () => {
    it('printOutput renders panel headers', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const output = {
        panel1: {
          planStatus: [],
          governanceHealth: [],
          evidenceCoverage: [],
          temporalConfidence: [],
          contradictions: [],
          openHypotheses: [],
          relevantClaims: [],
          integrity: { core: [], domain: [], summary: { totalChecks: 2, passed: 2, failed: 0, criticalFailures: 0 } },
        },
        panel2: { agentId: 'watson', status: 'IDLE', briefing: null, sessionBookmark: null },
        panel3: { deltas: [] },
        meta: { projectId: 'proj_test', depth: 'medium', durationMs: 10, runAt: '2026-03-25T00:00:00Z' },
      } as any;

      printOutput(output, false);

      const allOutput = log.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Panel 1A');
      expect(allOutput).toContain('Panel 1B');
      expect(allOutput).toContain('Panel 2');
      expect(allOutput).toContain('Panel 3');
      expect(allOutput).toContain('proj_test');
      log.mockRestore();
    });

    it('printOutput renders plan status observations', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const output = {
        panel1: {
          planStatus: [
            { value: { done: 100, total: 200, pct: 50 }, source: 'Task', observedAt: '', freshnessState: 'fresh', confidenceClass: 'exact' },
          ],
          governanceHealth: [],
          evidenceCoverage: [],
          temporalConfidence: [],
          contradictions: [],
          openHypotheses: [],
          relevantClaims: [],
          integrity: { core: [], domain: [], summary: { totalChecks: 0, passed: 0, failed: 0, criticalFailures: 0 } },
        },
        panel2: { agentId: 'watson', status: 'IDLE', briefing: null, sessionBookmark: null },
        panel3: { deltas: [] },
        meta: { projectId: 'proj_test', depth: 'fast', durationMs: 5, runAt: '2026-03-25T00:00:00Z' },
      } as any;

      printOutput(output, false);

      const allOutput = log.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('100');
      expect(allOutput).toContain('200');
      log.mockRestore();
    });

    it('printOutput renders integrity failures in brief mode', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const output = {
        panel1: {
          planStatus: [],
          governanceHealth: [],
          evidenceCoverage: [],
          temporalConfidence: [],
          contradictions: [],
          openHypotheses: [],
          relevantClaims: [],
          integrity: {
            core: [{
              definitionId: 'test_fail',
              surface: 'schema',
              surfaceClass: 'core',
              severity: 'critical',
              description: 'Missing labels',
              observedValue: 42,
              expectedValue: 0,
              pass: false,
              trend: 'stable',
              tier: 'medium',
              observedAt: '',
            }],
            domain: [],
            summary: { totalChecks: 1, passed: 0, failed: 1, criticalFailures: 1 },
          },
        },
        panel2: { agentId: 'watson', status: 'IDLE', briefing: null, sessionBookmark: null },
        panel3: { deltas: [] },
        meta: { projectId: 'proj_test', depth: 'fast', durationMs: 5, runAt: '2026-03-25T00:00:00Z' },
      } as any;

      printOutput(output, false);

      const allOutput = log.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('CRITICAL');
      expect(allOutput).toContain('Missing labels');
      expect(allOutput).toContain('42');
      log.mockRestore();
    });

    it('printOutput verbose mode shows all checks including passing', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const output = {
        panel1: {
          planStatus: [],
          governanceHealth: [],
          evidenceCoverage: [],
          temporalConfidence: [],
          contradictions: [],
          openHypotheses: [],
          relevantClaims: [],
          integrity: {
            core: [{
              definitionId: 'test_pass',
              surface: 'freshness',
              surfaceClass: 'core',
              severity: 'info',
              description: 'All fresh',
              observedValue: 0,
              expectedValue: 0,
              pass: true,
              trend: 'stable',
              tier: 'fast',
              observedAt: '',
            }],
            domain: [],
            summary: { totalChecks: 1, passed: 1, failed: 0, criticalFailures: 0 },
          },
        },
        panel2: { agentId: 'watson', status: 'IDLE', briefing: null, sessionBookmark: null },
        panel3: { deltas: [] },
        meta: { projectId: 'proj_test', depth: 'fast', durationMs: 5, runAt: '2026-03-25T00:00:00Z' },
      } as any;

      printOutput(output, true);

      const allOutput = log.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('All fresh');
      expect(allOutput).toContain('PASS');
      expect(allOutput).toContain('VERBOSE');
      log.mockRestore();
    });

    it('printOutput renders delta items', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const output = {
        panel1: {
          planStatus: [],
          governanceHealth: [],
          evidenceCoverage: [],
          temporalConfidence: [],
          contradictions: [],
          openHypotheses: [],
          relevantClaims: [],
          integrity: { core: [], domain: [], summary: { totalChecks: 0, passed: 0, failed: 0, criticalFailures: 0 } },
        },
        panel2: { agentId: 'watson', status: 'IDLE', briefing: null, sessionBookmark: null },
        panel3: {
          deltas: [
            { tier: 'exact', severity: 'critical', description: 'Task already done in graph' },
          ],
        },
        meta: { projectId: 'proj_test', depth: 'fast', durationMs: 5, runAt: '2026-03-25T00:00:00Z' },
      } as any;

      printOutput(output, false);

      const allOutput = log.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Task already done');
      expect(allOutput).toContain('exact');
      log.mockRestore();
    });
  });

  // ─── Behavior 6: Closes Neo4j in finally block ─────────────────

  describe('B6: Closes Neo4j connection in finally block', () => {
    it('calls neo4j.close() after successful run', async () => {
      await main();
      // Neo4jService was constructed — get its instance and check close was called
      const neo4jInstance = (Neo4jService as any).mock.results[0]?.value;
      expect(neo4jInstance).toBeDefined();
      expect(neo4jInstance.close).toHaveBeenCalledTimes(1);
    });

    it('calls neo4j.close() even when runtime.run() throws', async () => {
      runtimeRunRef.fn = vi.fn().mockRejectedValue(new Error('Runtime exploded'));

      await expect(main()).rejects.toThrow('Runtime exploded');
      const neo4jInstance = (Neo4jService as any).mock.results[0]?.value;
      expect(neo4jInstance).toBeDefined();
      expect(neo4jInstance.close).toHaveBeenCalledTimes(1);
    });
  });
});
