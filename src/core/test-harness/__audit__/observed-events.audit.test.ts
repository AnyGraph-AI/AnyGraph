/**
 * AUD-TC-11c-L2-07: Supplementary audit tests for observed-events.ts
 *
 * Covers gaps identified in B6 verification:
 * - MERGE idempotency (not CREATE) for all 4 emitters
 * - projectId scoping enforcement in all edges
 * - Timestamp defaults when opts.timestamp not provided
 * - Error resilience for emitReferenced, emitCommitReferencesTask, emitVerifiedByRun
 * - ON CREATE / ON MATCH property differentiation
 * - Multiple regex pattern coverage for commit references
 *
 * Source: src/core/ground-truth/observed-events.ts (164 lines, 4 CRITICAL functions)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  emitTouched,
  emitReferenced,
  emitCommitReferencesTask,
  emitVerifiedByRun,
} from '../../ground-truth/observed-events.js';

function createMockNeo4j() {
  return {
    run: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AUD-TC-11c-L2-07: observed-events supplementary audit', () => {
  let neo4j: ReturnType<typeof createMockNeo4j>;

  beforeEach(() => {
    neo4j = createMockNeo4j();
  });

  // ─── MERGE Idempotency (Behavior 6) ────────────────────────────

  describe('MERGE idempotency (all edges use MERGE, not CREATE)', () => {
    it('emitTouched uses MERGE for idempotent edge creation', async () => {
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('MERGE');
      expect(cypher).not.toMatch(/\bCREATE\b.*TOUCHED/); // No raw CREATE for the edge
    });

    it('emitReferenced uses MERGE for idempotent edge creation', async () => {
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('MERGE');
      expect(cypher).not.toMatch(/\bCREATE\b.*REFERENCED/);
    });

    it('emitCommitReferencesTask uses MERGE for Commit node and edge', async () => {
      neo4j.run.mockResolvedValue([{ name: 'GTH-1 task' }]);
      await emitCommitReferencesTask(neo4j, 'abc123', 'feat(GTH-1): test', 'plan_codegraph');
      const cypher = neo4j.run.mock.calls[0][0] as string;
      // Both Commit node and edge should use MERGE
      const mergeCount = (cypher.match(/MERGE/g) || []).length;
      expect(mergeCount).toBeGreaterThanOrEqual(2);
    });

    it('emitVerifiedByRun uses MERGE for VerificationRun node', async () => {
      await emitVerifiedByRun(neo4j, 'run_1', 'PASS', 'proj_test', ['src/a.ts']);
      const runCypher = neo4j.run.mock.calls[0][0] as string;
      expect(runCypher).toContain('MERGE');
      // File linking also uses MERGE
      const linkCypher = neo4j.run.mock.calls[1][0] as string;
      expect(linkCypher).toContain('MERGE');
    });
  });

  // ─── ProjectId Scoping (Behavior 5) ────────────────────────────

  describe('projectId scoping in all edges', () => {
    it('emitTouched passes projectId to query params', async () => {
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_abc' });
      const params = neo4j.run.mock.calls[0][1];
      expect(params.projectId).toBe('proj_abc');
      // Cypher should reference $projectId
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('$projectId');
    });

    it('emitReferenced passes projectId to query params', async () => {
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_xyz' });
      const params = neo4j.run.mock.calls[0][1];
      expect(params.projectId).toBe('proj_xyz');
    });

    it('emitCommitReferencesTask passes projectId to query params', async () => {
      neo4j.run.mockResolvedValue([{ name: 'task' }]);
      await emitCommitReferencesTask(neo4j, 'hash', 'feat(GTH-1): x', 'plan_codegraph');
      const params = neo4j.run.mock.calls[0][1];
      expect(params.projectId).toBe('plan_codegraph');
    });

    it('emitVerifiedByRun passes projectId to both queries', async () => {
      await emitVerifiedByRun(neo4j, 'run_1', 'PASS', 'proj_test', ['src/a.ts']);
      expect(neo4j.run.mock.calls[0][1].projectId).toBe('proj_test');
      expect(neo4j.run.mock.calls[1][1].projectId).toBe('proj_test');
    });
  });

  // ─── Timestamp Defaults ─────────────────────────────────────────

  describe('timestamp defaults when not provided', () => {
    it('emitTouched generates ISO timestamp when opts.timestamp is undefined', async () => {
      const before = new Date().toISOString();
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
      const after = new Date().toISOString();
      const params = neo4j.run.mock.calls[0][1];
      expect(params.now).toBeTruthy();
      expect(params.now >= before).toBe(true);
      expect(params.now <= after).toBe(true);
    });

    it('emitTouched uses provided timestamp when given', async () => {
      const custom = '2026-01-01T00:00:00.000Z';
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test', timestamp: custom });
      const params = neo4j.run.mock.calls[0][1];
      expect(params.now).toBe(custom);
    });

    it('emitReferenced generates ISO timestamp when opts.timestamp is undefined', async () => {
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_test' });
      const params = neo4j.run.mock.calls[0][1];
      expect(params.now).toBeTruthy();
      // Should be a valid ISO timestamp
      expect(new Date(params.now).toISOString()).toBe(params.now);
    });
  });

  // ─── Error Resilience (all 4 functions) ─────────────────────────

  describe('error resilience — Neo4j failures must not throw', () => {
    it('emitReferenced survives Neo4j errors silently', async () => {
      neo4j.run.mockRejectedValueOnce(new Error('Connection refused'));
      // Should not throw
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_test' });
    });

    it('emitCommitReferencesTask survives Neo4j errors silently', async () => {
      neo4j.run.mockRejectedValueOnce(new Error('Connection refused'));
      const result = await emitCommitReferencesTask(neo4j, 'hash', 'feat(GTH-1): test', 'plan_codegraph');
      expect(result).toEqual([]);
    });

    it('emitVerifiedByRun survives Neo4j errors silently', async () => {
      neo4j.run.mockRejectedValueOnce(new Error('Connection refused'));
      // Should not throw
      await emitVerifiedByRun(neo4j, 'run_1', 'PASS', 'proj_test', ['a.ts']);
    });
  });

  // ─── ON CREATE / ON MATCH semantics ─────────────────────────────

  describe('ON CREATE / ON MATCH property handling', () => {
    it('emitTouched sets firstSeen on CREATE, updates lastSeen and count on MATCH', async () => {
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('ON CREATE SET');
      expect(cypher).toContain('ON MATCH SET');
      expect(cypher).toContain('firstSeen');
      expect(cypher).toContain('lastSeen');
      expect(cypher).toContain('count');
    });

    it('emitReferenced sets firstSeen on CREATE, updates lastSeen and count on MATCH', async () => {
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('ON CREATE SET');
      expect(cypher).toContain('ON MATCH SET');
      expect(cypher).toContain('count');
    });

    it('emitVerifiedByRun sets observedAt/validFrom on CREATE, preserves on MATCH', async () => {
      await emitVerifiedByRun(neo4j, 'run_1', 'PASS', 'proj_test');
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('ON CREATE SET');
      expect(cypher).toContain('ON MATCH SET');
      expect(cypher).toContain('observedAt');
      expect(cypher).toContain('validFrom');
    });
  });

  // ─── Commit reference regex patterns ────────────────────────────

  describe('emitCommitReferencesTask regex patterns', () => {
    it('extracts TC-N references', async () => {
      neo4j.run.mockResolvedValue([{ name: 'TC-8 task' }]);
      const matched = await emitCommitReferencesTask(neo4j, 'hash', 'fix(TC-8): calibration', 'plan_codegraph');
      // Verify the query was called with refs including TC-8
      const params = neo4j.run.mock.calls[0][1];
      expect(params.refs).toContain('TC-8');
    });

    it('extracts multiple references from a single commit', async () => {
      neo4j.run.mockResolvedValue([{ name: 'task' }]);
      await emitCommitReferencesTask(neo4j, 'hash', 'feat(GTH-1): runtime + RF-2 gate', 'plan_codegraph');
      const params = neo4j.run.mock.calls[0][1];
      expect(params.refs).toContain('GTH-1');
      expect(params.refs).toContain('RF-2');
    });

    it('extracts N-prefixed milestone references (N01, N02, etc.)', async () => {
      neo4j.run.mockResolvedValue([{ name: 'N01 task' }]);
      await emitCommitReferencesTask(neo4j, 'hash', 'feat: governance freeze (N01)', 'plan_codegraph');
      const params = neo4j.run.mock.calls[0][1];
      expect(params.refs).toContain('N01');
    });

    it('handles case-insensitive matching', async () => {
      neo4j.run.mockResolvedValue([{ name: 'task' }]);
      await emitCommitReferencesTask(neo4j, 'hash', 'fix: gth-3 delta engine', 'plan_codegraph');
      const params = neo4j.run.mock.calls[0][1];
      // Case-insensitive flag on regex
      expect(params.refs.map((r: string) => r.toUpperCase())).toContain('GTH-3');
    });
  });

  // ─── SessionBookmark status filter ──────────────────────────────

  describe('SessionBookmark status constraint', () => {
    it('emitTouched only matches active bookmark statuses (claimed/in_progress/completing)', async () => {
      await emitTouched(neo4j, 'src/foo.ts', { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('claimed');
      expect(cypher).toContain('in_progress');
      expect(cypher).toContain('completing');
    });

    it('emitReferenced only matches active bookmark statuses', async () => {
      await emitReferenced(neo4j, ['a.ts'], { agentId: 'watson', projectId: 'proj_test' });
      const cypher = neo4j.run.mock.calls[0][0] as string;
      expect(cypher).toContain('claimed');
      expect(cypher).toContain('in_progress');
      expect(cypher).toContain('completing');
    });
  });
});
