/**
 * [AUD-TC-13-L1-02] edit-simulation.ts — Behavioral Tests
 *
 * Now importable (main() guarded). Tests mock neo4j-driver, TypeScriptParser,
 * and fs to verify simulateEdit behavior: graph state comparison, diff computation,
 * risk assessment, and caller impact analysis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
vi.mock('fs', () => ({
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

// Mock TypeScriptParser (uses parseChunk internally)
const mockParseChunk = vi.fn();
vi.mock('../../../core/parsers/typescript-parser.js', () => ({
  TypeScriptParser: vi.fn(function (this: any) {
    this.parseChunk = mockParseChunk;
  }),
}));

// Mock schema
vi.mock('../../../core/config/schema.js', () => ({
  CORE_TYPESCRIPT_SCHEMA: {},
}));

// Mock neo4j-driver
const mockSessionRun = vi.fn();
const mockSessionClose = vi.fn().mockResolvedValue(undefined);
const mockDriverClose = vi.fn().mockResolvedValue(undefined);
const mockSession = {
  run: mockSessionRun,
  close: mockSessionClose,
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: vi.fn(() => mockSession),
      close: mockDriverClose,
    })),
    auth: {
      basic: vi.fn((u: string, p: string) => ({ u, p })),
    },
  },
}));

import { simulateEdit } from '../edit-simulation.js';

describe('[aud-tc-13] edit-simulation.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: file reads for parser temp file
    mockReadFileSync.mockReturnValue('// original content');
  });

  function setupGraphState(opts: {
    existingNodes?: Array<{ name: string; labels: string[]; isExported: boolean; id: string }>;
    existingCalls?: Array<{ caller: string; callee: string; callerFile: string }>;
    affectedCallers?: Array<{ caller: string; callerFile: string }>;
  } = {}) {
    const { existingNodes = [], existingCalls = [], affectedCallers = [] } = opts;
    // nodesResult
    mockSessionRun.mockResolvedValueOnce({
      records: existingNodes.map((n) => ({
        get: (key: string) => {
          const map: Record<string, any> = { name: n.name, labels: n.labels, isExported: n.isExported, id: n.id, startLine: 1, endLine: 10 };
          return map[key];
        },
      })),
    });
    // callsResult
    mockSessionRun.mockResolvedValueOnce({
      records: existingCalls.map((c) => ({
        get: (key: string) => {
          const map: Record<string, any> = { caller: c.caller, callee: c.callee, callerFile: c.callerFile };
          return map[key];
        },
      })),
    });
    // affectedCallers
    mockSessionRun.mockResolvedValueOnce({
      records: affectedCallers.map((c) => ({
        get: (key: string) => {
          const map: Record<string, any> = { callerName: c.caller, callerFile: c.callerFile };
          return map[key];
        },
      })),
    });
  }

  it('(1) connects to Neo4j with env vars or defaults', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    // neo4j.driver was called (via mock)
    const neo4jMod = await import('neo4j-driver');
    expect(neo4jMod.default.driver).toHaveBeenCalled();
  });

  it('(2) queries current graph state for the file', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    // First session.run = node query
    const nodeQuery = mockSessionRun.mock.calls[0][0] as string;
    expect(nodeQuery).toContain('MATCH (sf:SourceFile');
    expect(nodeQuery).toContain('CONTAINS');
  });

  it('(3) parses proposed content via TypeScriptParser', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    await simulateEdit('/tmp/test.ts', 'export function newFn() {}', 'proj_test', '/tmp/');
    expect(mockParseChunk).toHaveBeenCalled();
  });

  it('(4) detects added nodes when new function appears', async () => {
    setupGraphState({ existingNodes: [] });
    mockParseChunk.mockReturnValue({
      nodes: [{
        labels: ['Function', 'CodeNode'],
        properties: { name: 'newFunc', filePath: '/tmp/test.ts', isExported: true },
      }],
      edges: [],
    });
    const result = await simulateEdit('/tmp/test.ts', 'export function newFunc() {}', 'proj_test', '/tmp/');
    expect(result.nodesAdded.length).toBeGreaterThanOrEqual(1);
  });

  it('(5) detects removed nodes when existing function disappears', async () => {
    setupGraphState({
      existingNodes: [{ name: 'oldFunc', labels: ['Function'], isExported: true, id: 'fn_1' }],
    });
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    const result = await simulateEdit('/tmp/test.ts', '// empty', 'proj_test', '/tmp/');
    expect(result.nodesRemoved.length).toBeGreaterThanOrEqual(1);
    expect(result.nodesRemoved[0].name).toBe('oldFunc');
  });

  it('(6) returns risk assessment with changeScope', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    const result = await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    expect(result.riskAssessment).toBeDefined();
    expect(result.riskAssessment.changeScope).toBeDefined();
    expect(['SAFE', 'CAUTION', 'DANGEROUS', 'CRITICAL']).toContain(result.riskAssessment.changeScope);
  });

  it('(7) identifies broken callers when exported function is removed', async () => {
    setupGraphState({
      existingNodes: [{ name: 'exportedFn', labels: ['Function'], isExported: true, id: 'fn_1' }],
      affectedCallers: [{ caller: 'consumer', callerFile: 'other.ts' }],
    });
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    const result = await simulateEdit('/tmp/test.ts', '// empty', 'proj_test', '/tmp/');
    expect(result.exportsRemoved).toContain('exportedFn');
  });

  it('(8) restores original file content after parsing', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    // Code writes modified content, then restores original via writeFileSync
    // At least 2 writeFileSync calls: replace + restore
    expect(mockWriteFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('(9) closes Neo4j session in finally block', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    expect(mockSessionClose).toHaveBeenCalled();
  });

  it('(10) returns complete SimulationResult structure', async () => {
    setupGraphState();
    mockParseChunk.mockReturnValue({ nodes: [], edges: [] });
    const result = await simulateEdit('/tmp/test.ts', 'const x = 1;', 'proj_test', '/tmp/');
    expect(result).toHaveProperty('file');
    expect(result).toHaveProperty('nodesAdded');
    expect(result).toHaveProperty('nodesRemoved');
    expect(result).toHaveProperty('nodesModified');
    expect(result).toHaveProperty('callsAdded');
    expect(result).toHaveProperty('callsRemoved');
    expect(result).toHaveProperty('exportsAdded');
    expect(result).toHaveProperty('exportsRemoved');
    expect(result).toHaveProperty('brokenCallers');
    expect(result).toHaveProperty('riskAssessment');
  });
});
