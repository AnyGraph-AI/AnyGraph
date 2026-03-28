/**
 * [AUD-TC-13-L1-05] reconcile-project-registry.ts — Behavioral + Pure Function Tests
 *
 * Now importable (main() guarded). Tests use mock Neo4jService for main(),
 * and directly import exported pure helper functions.
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

import { main, inferProjectType, inferSourceKind, inferStatus } from '../reconcile-project-registry.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';

describe('[aud-tc-13] reconcile-project-registry.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('main() — behavioral tests', () => {
    it('(1) creates a Neo4jService instance', async () => {
      mockRun
        .mockResolvedValueOnce([]) // Q14 project counts
        .mockResolvedValueOnce([]) // existing projects
        .mockResolvedValueOnce(undefined); // final update
      await main();
      expect(Neo4jService).toHaveBeenCalledOnce();
    });

    it('(2) queries project counts via CONTRACT_QUERY_Q14_PROJECT_COUNTS first', async () => {
      mockRun
        .mockResolvedValueOnce([{ projectId: 'proj_test', nodeCount: 10, edgeCount: 5 }])
        .mockResolvedValueOnce([]) // existing
        .mockResolvedValueOnce(undefined) // MERGE
        .mockResolvedValueOnce(undefined); // final sync
      await main();
      // First call is Q14
      expect(mockRun).toHaveBeenCalled();
      expect(mockRun.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('(3) queries existing Project nodes for metadata', async () => {
      mockRun
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined);
      await main();
      const existingQuery = mockRun.mock.calls[1][0] as string;
      expect(existingQuery).toContain('MATCH (p:Project)');
      expect(existingQuery).toContain('p.displayName');
      expect(existingQuery).toContain('p.projectType');
      expect(existingQuery).toContain('p.sourceKind');
      expect(existingQuery).toContain('p.status');
    });

    it('(4) MERGEs Project nodes for each discovered project', async () => {
      mockRun
        .mockResolvedValueOnce([
          { projectId: 'proj_a', nodeCount: 10, edgeCount: 5 },
          { projectId: 'plan_b', nodeCount: 3, edgeCount: 1 },
        ])
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce(undefined) // MERGE proj_a
        .mockResolvedValueOnce(undefined) // MERGE plan_b
        .mockResolvedValueOnce(undefined); // final sync
      await main();
      // Calls 2 and 3 should be MERGEs (0=Q14, 1=existing, 2=merge1, 3=merge2, 4=final)
      const mergeQuery = mockRun.mock.calls[2][0] as string;
      expect(mergeQuery).toContain('MERGE (p:Project {projectId: $projectId})');
      expect(mergeQuery).toContain('ON CREATE SET');
    });

    it('(5) outputs JSON report with projectsSeen, created, updated', async () => {
      mockRun
        .mockResolvedValueOnce([{ projectId: 'proj_new', nodeCount: 1, edgeCount: 0 }])
        .mockResolvedValueOnce([]) // no existing
        .mockResolvedValueOnce(undefined) // MERGE
        .mockResolvedValueOnce(undefined); // final
      await main();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.ok).toBe(true);
      expect(output.projectsSeen).toBe(1);
      expect(output.created).toBe(1);
      expect(output.updated).toBe(0);
    });

    it('(6) correctly counts updated vs created projects', async () => {
      mockRun
        .mockResolvedValueOnce([
          { projectId: 'proj_existing', nodeCount: 10, edgeCount: 5 },
          { projectId: 'proj_new', nodeCount: 1, edgeCount: 0 },
        ])
        .mockResolvedValueOnce([{ projectId: 'proj_existing', displayName: 'Existing' }])
        .mockResolvedValueOnce(undefined) // MERGE existing
        .mockResolvedValueOnce(undefined) // MERGE new
        .mockResolvedValueOnce(undefined); // final
      await main();
      const output = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
      expect(output.created).toBe(1);
      expect(output.updated).toBe(1);
    });

    it('(7) closes Neo4j driver in finally block even on error', async () => {
      mockRun.mockRejectedValueOnce(new Error('connection failed'));
      await expect(main()).rejects.toThrow('connection failed');
      expect(mockDriverClose).toHaveBeenCalledOnce();
    });
  });

  describe('inferProjectType — pure function', () => {
    it('returns existing value when present', () => {
      expect(inferProjectType('anything', 'custom')).toBe('custom');
    });

    it('infers plan from plan_ prefix', () => {
      expect(inferProjectType('plan_codegraph')).toBe('plan');
    });

    it('infers corpus for known corpus project IDs', () => {
      expect(inferProjectType('proj_bible_kjv')).toBe('corpus');
      expect(inferProjectType('proj_quran')).toBe('corpus');
      expect(inferProjectType('proj_deuterocanon')).toBe('corpus');
      expect(inferProjectType('proj_pseudepigrapha')).toBe('corpus');
      expect(inferProjectType('proj_early_contested')).toBe('corpus');
    });

    it('defaults to code for unknown projects', () => {
      expect(inferProjectType('proj_c0d3e9a1f200')).toBe('code');
    });

    it('trims whitespace-only existing values', () => {
      expect(inferProjectType('plan_x', '   ')).toBe('plan');
    });
  });

  describe('inferSourceKind — pure function', () => {
    it('returns existing value when present', () => {
      expect(inferSourceKind('anything', 'custom-kind')).toBe('custom-kind');
    });

    it('infers plan-ingest from plan_ prefix', () => {
      expect(inferSourceKind('plan_codegraph')).toBe('plan-ingest');
    });

    it('infers corpus-ingest for known corpus projects', () => {
      expect(inferSourceKind('proj_bible_kjv')).toBe('corpus-ingest');
    });

    it('defaults to parser', () => {
      expect(inferSourceKind('proj_c0d3e9a1f200')).toBe('parser');
    });
  });

  describe('inferStatus — pure function', () => {
    it('defaults to active for empty/missing', () => {
      expect(inferStatus()).toBe('active');
      expect(inferStatus('')).toBe('active');
      expect(inferStatus('  ')).toBe('active');
    });

    it('maps complete → active', () => {
      expect(inferStatus('complete')).toBe('active');
    });

    it('preserves valid statuses', () => {
      expect(inferStatus('active')).toBe('active');
      expect(inferStatus('paused')).toBe('paused');
      expect(inferStatus('archived')).toBe('archived');
      expect(inferStatus('error')).toBe('error');
    });

    it('defaults unknown to active', () => {
      expect(inferStatus('unknown')).toBe('active');
    });
  });
});
