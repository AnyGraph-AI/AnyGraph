/**
 * [AUD-TC-13-L1-04] recompute-plan-evidence-flags.ts — Behavioral Tests
 *
 * Now importable (main() guarded). Tests use mock Neo4jService
 * to verify Cypher queries, property assignments, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Neo4jService
const mockRun = vi.fn();
const mockDriverClose = vi.fn().mockResolvedValue(undefined);
const mockGetDriver = vi.fn(() => ({ close: mockDriverClose }));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function (this: any) {
    this.run = mockRun;
    this.getDriver = mockGetDriver;
  }),
}));

// Import AFTER mock setup (vi.mock is hoisted)
import { main } from '../recompute-plan-evidence-flags.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';

describe('[aud-tc-13] recompute-plan-evidence-flags.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('(1) creates a Neo4jService instance', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 5 }]);
    await main();
    expect(Neo4jService).toHaveBeenCalledOnce();
  });

  it('(2) runs a single Cypher query matching Task nodes with OPTIONAL MATCH on HAS_CODE_EVIDENCE', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 10 }]);
    await main();
    expect(mockRun).toHaveBeenCalledOnce();
    const query = mockRun.mock.calls[0][0] as string;
    expect(query).toContain('MATCH (t:Task)');
    expect(query).toContain('OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()');
  });

  it('(3) counts explicit evidence where refType IN [file_path, function]', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 0 }]);
    await main();
    const query = mockRun.mock.calls[0][0] as string;
    expect(query).toMatch(/refType\s+IN\s+\[.?file_path.+function/s);
  });

  it('(4) counts semantic evidence where refType = semantic_keyword', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 0 }]);
    await main();
    const query = mockRun.mock.calls[0][0] as string;
    expect(query).toContain("refType = 'semantic_keyword'");
  });

  it('(5) SETs 4 properties on each Task node', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 0 }]);
    await main();
    const query = mockRun.mock.calls[0][0] as string;
    expect(query).toContain('t.hasCodeEvidence');
    expect(query).toContain('t.codeEvidenceCount');
    expect(query).toContain('t.hasSemanticEvidence');
    expect(query).toContain('t.semanticEvidenceCount');
  });

  it('(6) outputs JSON with ok=true and tasksUpdated count', async () => {
    mockRun.mockResolvedValueOnce([{ tasksUpdated: 42 }]);
    await main();
    expect(consoleLogSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output).toEqual({ ok: true, tasksUpdated: 42 });
  });

  it('(7) handles zero results gracefully', async () => {
    mockRun.mockResolvedValueOnce([{}]);
    await main();
    const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(output).toEqual({ ok: true, tasksUpdated: 0 });
  });

  it('(8) closes driver in finally block even on error', async () => {
    mockRun.mockRejectedValueOnce(new Error('Neo4j down'));
    await expect(main()).rejects.toThrow('Neo4j down');
    expect(mockDriverClose).toHaveBeenCalledOnce();
  });
});
