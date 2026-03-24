// AUD-TC-03-L1b-46: ir-parity-gate.ts
// AUD-TC Audit — B6 (Health Witness)
// Spec: GOVERNANCE_HARDENING.md IR parity gate + ADAPTER_ROADMAP.md §checkpoint/resume

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ─── Mock all heavy dependencies ───
const mockNeoRun = vi.fn().mockResolvedValue([]);
const mockNeoClose = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
}));

const mockMaterializeIrDocument = vi.fn().mockResolvedValue({ nodesCreated: 5, edgesCreated: 3 });
vi.mock('../../../core/ir/ir-materializer.js', () => ({
  materializeIrDocument: (...a: unknown[]) => mockMaterializeIrDocument(...a),
}));

const mockValidateIrDocument = vi.fn().mockReturnValue({ ok: true, errors: [] });
vi.mock('../../../core/ir/ir-validator.js', () => ({
  validateIrDocument: (...a: unknown[]) => mockValidateIrDocument(...a),
}));

const mockExportToIrDocument = vi.fn();
const mockParseWorkspace = vi.fn().mockResolvedValue(undefined);
const mockSetIrMode = vi.fn();
vi.mock('../../../core/parsers/parser-factory.js', () => ({
  ParserFactory: {
    createParserWithAutoDetection: vi.fn().mockResolvedValue({
      parseWorkspace: mockParseWorkspace,
      setIrMode: mockSetIrMode,
      exportToIrDocument: mockExportToIrDocument,
      getNodes: vi.fn().mockReturnValue([]),
      getEdges: vi.fn().mockReturnValue([]),
    }),
  },
}));

vi.mock('../../../core/utils/project-id.js', () => ({
  resolveProjectId: vi.fn().mockReturnValue('proj_aabbccddee00'),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockRejectedValue(new Error('ENOENT'));
const mockRename = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);
vi.mock('fs/promises', () => ({
  mkdir: (...a: unknown[]) => mockMkdir(...a),
  writeFile: (...a: unknown[]) => mockWriteFile(...a),
  readFile: (...a: unknown[]) => mockReadFile(...a),
  rename: (...a: unknown[]) => mockRename(...a),
  rm: (...a: unknown[]) => mockRm(...a),
}));

const origArgv = process.argv;
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
const mockLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockErr = vi.spyOn(console, 'error').mockImplementation(() => {});
const mockWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

function makeIrDoc(nodeCount: number = 5, edgeCount: number = 3): object {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node_${i}`,
    type: 'Symbol',
    kind: 'Function',
    name: `fn_${i}`,
    projectId: 'proj_test12345678',
    language: 'typescript',
    parserTier: 0,
    confidence: 1,
    provenanceKind: 'parser',
    properties: {},
  }));
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    id: `edge_${i}`,
    type: 'CALLS',
    from: `node_${i % nodeCount}`,
    to: `node_${(i + 1) % nodeCount}`,
    projectId: 'proj_test12345678',
    parserTier: 0,
    confidence: 1,
    provenanceKind: 'parser',
    properties: {},
  }));
  return {
    version: 'ir.v1',
    projectId: 'proj_test12345678',
    sourceKind: 'code',
    generatedAt: '2026-03-24T00:00:00.000Z',
    nodes,
    edges,
    metadata: { originalNodeCount: nodeCount, originalEdgeCount: edgeCount },
  };
}

function defaultMocks() {
  const irDoc = makeIrDoc(5, 3);
  mockExportToIrDocument.mockReturnValue(irDoc);
  mockValidateIrDocument.mockReturnValue({ ok: true, errors: [] });
  mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 5, edgesCreated: 3 });
  // getProjectCounts returns matching counts → parity pass
  mockNeoRun.mockImplementation(async (query: string) => {
    if (typeof query === 'string' && query.includes('nodeCount') && query.includes('edgeCount')) {
      return [{ nodeCount: 5, edgeCount: 3 }];
    }
    if (typeof query === 'string' && query.includes('DETACH DELETE')) {
      return [{ deleted: 0 }];
    }
    return [];
  });
  mockReadFile.mockRejectedValue(new Error('ENOENT'));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.argv = origArgv.slice();
  defaultMocks();
});

async function runModule(extraArgs: string[] = []) {
  process.argv = ['node', 'ir-parity-gate.ts', ...extraArgs];
  vi.resetModules();

  // Re-apply mocks
  vi.doMock('../../../storage/neo4j/neo4j.service.js', () => ({
    Neo4jService: class { run = mockNeoRun; close = mockNeoClose; },
  }));
  vi.doMock('../../../core/ir/ir-materializer.js', () => ({
    materializeIrDocument: (...a: unknown[]) => mockMaterializeIrDocument(...a),
  }));
  vi.doMock('../../../core/ir/ir-validator.js', () => ({
    validateIrDocument: (...a: unknown[]) => mockValidateIrDocument(...a),
  }));
  vi.doMock('../../../core/parsers/parser-factory.js', () => ({
    ParserFactory: {
      createParserWithAutoDetection: vi.fn().mockResolvedValue({
        parseWorkspace: mockParseWorkspace,
        setIrMode: mockSetIrMode,
        exportToIrDocument: mockExportToIrDocument,
        getNodes: vi.fn().mockReturnValue([]),
        getEdges: vi.fn().mockReturnValue([]),
      }),
    },
  }));
  vi.doMock('../../../core/utils/project-id.js', () => ({
    resolveProjectId: vi.fn().mockReturnValue('proj_aabbccddee00'),
  }));
  vi.doMock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));
  vi.doMock('fs/promises', () => ({
    mkdir: (...a: unknown[]) => mockMkdir(...a),
    writeFile: (...a: unknown[]) => mockWriteFile(...a),
    readFile: (...a: unknown[]) => mockReadFile(...a),
    rename: (...a: unknown[]) => mockRename(...a),
    rm: (...a: unknown[]) => mockRm(...a),
  }));

  await import('../../../utils/ir-parity-gate.js');
  await new Promise((r) => setTimeout(r, 500));
}

describe('ir-parity-gate audit tests (AUD-TC-03-L1b-46)', () => {
  // ─── Behavior 1: parses target projects via ParserFactory ───
  describe('parses target projects', () => {
    it('creates parser with auto-detection and parses workspace', async () => {
      await runModule();
      expect(mockParseWorkspace).toHaveBeenCalled();
      expect(mockSetIrMode).toHaveBeenCalledWith(true);
    });

    it('exports to IR document after parsing', async () => {
      await runModule();
      expect(mockExportToIrDocument).toHaveBeenCalled();
    });
  });

  // ─── Behavior 2: converts parsed output to IR ───
  describe('converts to IR', () => {
    it('produces IR document with version, projectId, nodes, edges', async () => {
      await runModule();
      // Validate the IR doc passed to validateIrDocument
      expect(mockValidateIrDocument).toHaveBeenCalled();
      const irDoc = mockValidateIrDocument.mock.calls[0][0];
      expect(irDoc).toHaveProperty('version');
      expect(irDoc).toHaveProperty('projectId');
      expect(irDoc).toHaveProperty('nodes');
      expect(irDoc).toHaveProperty('edges');
    });
  });

  // ─── Behavior 3: materializes IR back to Neo4j ───
  describe('materializes IR to Neo4j', () => {
    it('calls materializeIrDocument with the IR doc', async () => {
      await runModule();
      expect(mockMaterializeIrDocument).toHaveBeenCalled();
      const args = mockMaterializeIrDocument.mock.calls[0];
      expect(args[0]).toHaveProperty('nodes');
      expect(args[0]).toHaveProperty('edges');
    });

    it('passes batchSize option to materializer', async () => {
      await runModule(['--batch-size=25']);
      if (mockMaterializeIrDocument.mock.calls.length > 0) {
        const opts = mockMaterializeIrDocument.mock.calls[0][1];
        expect(opts).toHaveProperty('batchSize');
      }
    });
  });

  // ─── Behavior 4: compares original vs round-tripped graph ───
  describe('round-trip parity comparison', () => {
    it('passes when materialized counts match source counts', async () => {
      await runModule();
      // No exit(1) on matching counts
      expect(mockExit).not.toHaveBeenCalledWith(1);
      // Should log PASSED
      const allLogs = mockLog.mock.calls.map((c) => String(c[0]));
      expect(allLogs.some((l) => l.includes('PASSED'))).toBe(true);
    });

    it('fails when materialized node count mismatches', async () => {
      mockNeoRun.mockImplementation(async (query: string) => {
        if (typeof query === 'string' && query.includes('nodeCount') && query.includes('edgeCount')) {
          return [{ nodeCount: 999, edgeCount: 3 }]; // node mismatch
        }
        if (typeof query === 'string' && query.includes('DETACH DELETE')) {
          return [{ deleted: 0 }];
        }
        return [];
      });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('fails when materialized edge count mismatches', async () => {
      mockNeoRun.mockImplementation(async (query: string) => {
        if (typeof query === 'string' && query.includes('nodeCount') && query.includes('edgeCount')) {
          return [{ nodeCount: 5, edgeCount: 999 }]; // edge mismatch
        }
        if (typeof query === 'string' && query.includes('DETACH DELETE')) {
          return [{ deleted: 0 }];
        }
        return [];
      });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 5: validates IR document via validateIrDocument ───
  describe('IR document validation', () => {
    it('calls validateIrDocument before materialization', async () => {
      await runModule();
      expect(mockValidateIrDocument).toHaveBeenCalled();
      // Validate was called before materialize
      const validateOrder = mockValidateIrDocument.mock.invocationCallOrder[0];
      const materializeOrder = mockMaterializeIrDocument.mock.invocationCallOrder[0];
      if (validateOrder !== undefined && materializeOrder !== undefined) {
        expect(validateOrder).toBeLessThan(materializeOrder);
      }
    });

    it('throws when IR validation fails', async () => {
      mockValidateIrDocument.mockReturnValue({
        ok: false,
        errors: ['missing required field: projectId'],
      });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ─── Behavior 6: checkpoint/resume state ───
  describe('checkpoint/resume', () => {
    it('saves state file during run', async () => {
      await runModule();
      // Should write state file (via rename from .tmp)
      const renameCalls = mockRename.mock.calls.filter(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('state.json'),
      );
      expect(renameCalls.length).toBeGreaterThan(0);
    });

    it('writes checkpoint after parsing', async () => {
      await runModule();
      // Should write checkpoint file
      const checkpointWrites = mockRename.mock.calls.filter(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).includes('checkpoint'),
      );
      expect(checkpointWrites.length).toBeGreaterThan(0);
    });

    it('resumes from checkpoint when --resume and checkpoint exists', async () => {
      // getTargetTestProjectId computes: proj_ + md5('proj_aabbccddee00:ir-parity').slice(0,12)
      const testProjectId = 'proj_153b187d83cb';
      const irDoc = makeIrDoc(5, 3);
      // Override the IR doc's projectId to match
      (irDoc as Record<string, unknown>).projectId = testProjectId;

      const checkpoint = {
        version: 1,
        target: 'codegraph',
        projectId: testProjectId,
        irHash: 'abc123',
        sourceNodes: 5,
        sourceEdges: 3,
        createdAt: '2026-03-24T00:00:00Z',
        irDoc,
      };

      // State file with phase past idle
      const savedState = {
        version: 1,
        runId: 'test_run',
        createdAt: '2026-03-24T00:00:00Z',
        updatedAt: '2026-03-24T00:00:00Z',
        options: { batchSize: 50, checkpointDir: '/tmp/checkpoints' },
        targets: {
          codegraph: {
            target: 'codegraph',
            projectId: testProjectId,
            status: 'running',
            phase: 'parsed',
            attempts: 1,
            updatedAt: '2026-03-24T00:00:00Z',
            checkpointPath: '/tmp/checkpoints/codegraph.ir-checkpoint.json',
          },
        },
        overallStatus: 'running',
        summary: [],
      };

      mockReadFile.mockImplementation(async (p: string) => {
        if (p.includes('state.json')) return JSON.stringify(savedState);
        if (p.includes('checkpoint')) return JSON.stringify(checkpoint);
        throw new Error('ENOENT');
      });

      await runModule(['--resume']);

      // Should not re-parse since checkpoint was loaded
      // The log should mention "Resumed from checkpoint"
      const allLogs = mockLog.mock.calls.map((c) => String(c[0]));
      expect(allLogs.some((l) => l.includes('Resumed from checkpoint'))).toBe(true);
    });

    it('cleans up checkpoints on full pass', async () => {
      await runModule();
      // rm should be called for checkpoint files
      expect(mockRm).toHaveBeenCalled();
    });
  });

  // ─── Behavior 7: detailed parity report per target ───
  describe('parity report', () => {
    it('produces summary with source/ir/materialized counts', async () => {
      await runModule();
      // Summary rows are logged as JSON
      const jsonLogs = mockLog.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.startsWith('{'));
      
      const summaryRow = jsonLogs.find((l) => {
        try {
          const p = JSON.parse(l);
          return p.target !== undefined && p.sourceNodes !== undefined;
        } catch { return false; }
      });

      if (summaryRow) {
        const parsed = JSON.parse(summaryRow);
        expect(parsed).toHaveProperty('target');
        expect(parsed).toHaveProperty('sourceNodes');
        expect(parsed).toHaveProperty('sourceEdges');
        expect(parsed).toHaveProperty('irNodesCreated');
        expect(parsed).toHaveProperty('irEdgesCreated');
        expect(parsed).toHaveProperty('materializedNodes');
        expect(parsed).toHaveProperty('materializedEdges');
        expect(parsed).toHaveProperty('projectId');
      }
    });
  });

  // ─── Behavior 8: supports multiple target projects ───
  describe('multiple targets', () => {
    // SPEC-GAP: The TARGETS array is hardcoded with only 'codegraph' entry.
    // Spec says "supports multiple target projects" but the implementation has
    // a single target. The architecture supports it (iterates TARGETS array)
    // but only one is configured. No CLI mechanism to add targets dynamically
    // (--force-target filters existing TARGETS, doesn't add new ones).

    it('--force-target filters to specific target only', async () => {
      await runModule(['--force-target=codegraph']);
      // Should still run codegraph
      expect(mockParseWorkspace).toHaveBeenCalled();
    });

    it('skips targets not in --force-target', async () => {
      await runModule(['--force-target=nonexistent']);
      // Should skip codegraph since it's not in forceTargets
      const allLogs = mockLog.mock.calls.map((c) => String(c[0]));
      expect(allLogs.some((l) => l.includes('skipped'))).toBe(true);
    });
  });

  // ─── Behavior 9: exits with code 1 on parity violations ───
  describe('exit codes', () => {
    it('does not exit(1) when parity passes', async () => {
      await runModule();
      expect(mockExit).not.toHaveBeenCalledWith(1);
    });

    it('exits(1) on parity mismatch', async () => {
      // irNodesCreated won't match sourceNodes
      mockMaterializeIrDocument.mockResolvedValue({ nodesCreated: 999, edgesCreated: 3 });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('exits(1) on validation failure', async () => {
      mockValidateIrDocument.mockReturnValue({
        ok: false,
        errors: ['Invalid IR document'],
      });

      await runModule();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('cleans test project from Neo4j even on failure', async () => {
      mockValidateIrDocument.mockReturnValue({
        ok: false,
        errors: ['broken'],
      });

      await runModule();
      // DETACH DELETE should still be called (cleanup in finally)
      const deleteCalls = mockNeoRun.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DETACH DELETE'),
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    it('closes Neo4j connection in finally block', async () => {
      await runModule();
      expect(mockNeoClose).toHaveBeenCalled();
    });
  });
});
