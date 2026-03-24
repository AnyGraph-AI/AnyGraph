// AUD-TC-03-L1b-39 — B6 (Health Witness)
// Spec-derived audit tests for hygiene-gm-evidence-link.ts
// Spec: plans/codegraph/GOVERNANCE_HARDENING.md — GM-0..GM-7 evidence linking

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Neo4j driver mock ───
const mockRun = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockSession = { run: mockRun, close: mockClose };
const mockDriverClose = vi.fn().mockResolvedValue(undefined);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => ({
      session: () => mockSession,
      close: mockDriverClose,
    })),
    auth: { basic: vi.fn(() => ({})) },
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

describe('hygiene-gm-evidence-link audit tests', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
    errorOutput = [];
    console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
    process.exit = vi.fn() as any;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // ─── Behavior 1: creates HAS_CODE_EVIDENCE edges from GM tasks to implementing files ───
  describe('evidence edge creation', () => {
    it('creates HAS_CODE_EVIDENCE edges linking done GM tasks to SourceFile nodes', async () => {
      vi.resetModules();
      // First call for each milestone: query tasks → return one unlinked done task
      // Second call: query SourceFile nodes → return matching file
      // Third call: MERGE edge
      let callCount = 0;
      mockRun.mockImplementation((cypher: string) => {
        callCount++;
        if (cypher.includes('OPTIONAL MATCH (t)-[e:HAS_CODE_EVIDENCE]')) {
          // Tasks query — return one task
          return Promise.resolve({
            records: [
              { get: (key: string) => (key === 'taskId' ? 'task-gm0-1' : 'Validate plan dependency integrity') },
            ],
          });
        }
        if (cypher.includes('any(pat IN $patterns')) {
          // SourceFile query
          return Promise.resolve({
            records: [
              { get: (key: string) => (key === 'fileId' ? 'sf-1' : 'verify-plan-dependency-integrity.ts') },
            ],
          });
        }
        if (cypher.includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]->(sf)')) {
          return Promise.resolve({ records: [] });
        }
        return Promise.resolve({ records: [] });
      });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => {
        const mergeCalls = mockRun.mock.calls.filter(
          ([c]: [string]) => typeof c === 'string' && c.includes('HAS_CODE_EVIDENCE') && c.includes('MERGE (t)'),
        );
        return expect(mergeCalls.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      // Verify edge params
      const mergeCalls = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]->(sf)'),
      );
      for (const [, params] of mergeCalls) {
        expect(params.taskId).toBeDefined();
        expect(params.fileId).toBeDefined();
        expect(params.milestoneCode).toBeDefined();
        expect(params.linkedAt).toBeDefined();
      }
    });

    it('sets source=hygiene-gm-evidence-link and refType=file_path on created edges', async () => {
      vi.resetModules();
      mockRun.mockImplementation((cypher: string) => {
        if (cypher.includes('OPTIONAL MATCH (t)-[e:HAS_CODE_EVIDENCE]')) {
          return Promise.resolve({
            records: [{ get: (key: string) => (key === 'taskId' ? 'task-1' : 'task name') }],
          });
        }
        if (cypher.includes('any(pat IN $patterns')) {
          return Promise.resolve({
            records: [{ get: (key: string) => (key === 'fileId' ? 'sf-1' : 'file.ts') }],
          });
        }
        return Promise.resolve({ records: [] });
      });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const edgeCypher = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('MERGE (t)-[e:HAS_CODE_EVIDENCE]->(sf)'),
      );
      if (edgeCypher) {
        expect(edgeCypher[0]).toContain("e.source = 'hygiene-gm-evidence-link'");
        expect(edgeCypher[0]).toContain("e.refType = 'file_path'");
      }
    });
  });

  // ─── Behavior 2: advisory-only (creates edges, does not modify task status) ───
  describe('advisory-only mode', () => {
    it('never SETs task.status in any Cypher statement', async () => {
      vi.resetModules();
      mockRun.mockResolvedValue({ records: [] });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const allCyphers = mockRun.mock.calls.map(([c]: [string]) => c);
      for (const cypher of allCyphers) {
        expect(cypher).not.toMatch(/SET\s+t\.status/i);
      }
    });
  });

  // ─── Behavior 3: uses direct neo4j-driver ───
  describe('direct neo4j-driver usage', () => {
    it('closes session and driver in finally block', async () => {
      vi.resetModules();
      mockRun.mockResolvedValue({ records: [] });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(mockClose).toHaveBeenCalled(), { timeout: 2000 });

      expect(mockClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });

    it('exits with code 1 and JSON error on failure', async () => {
      vi.resetModules();
      mockRun.mockRejectedValue(new Error('Neo4j down'));

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errorJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errorJson).toBeDefined();
    });
  });

  // ─── Behavior 4: reports link counts ───
  describe('reporting', () => {
    it('outputs JSON with totalLinked and totalSkipped counts', async () => {
      vi.resetModules();
      mockRun.mockResolvedValue({ records: [] });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed).toHaveProperty('ok', true);
      expect(parsed).toHaveProperty('totalLinked');
      expect(parsed).toHaveProperty('totalSkipped');
      expect(parsed).toHaveProperty('milestones');
    });

    it('covers GM-0 through GM-7 milestones', async () => {
      vi.resetModules();
      mockRun.mockResolvedValue({ records: [] });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      const expected = ['GM-0', 'GM-1', 'GM-2', 'GM-3', 'GM-4', 'GM-5', 'GM-6', 'GM-7'];
      for (const m of expected) {
        expect(parsed.milestones).toContain(m);
      }
    });
  });

  // ─── Behavior 5: accepts PROJECT_ID from env ───
  describe('PROJECT_ID env support', () => {
    it('uses PROJECT_ID from env for SourceFile queries', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_testgm123456';
      mockRun.mockImplementation((cypher: string) => {
        if (cypher.includes('any(pat IN $patterns')) {
          return Promise.resolve({ records: [] });
        }
        return Promise.resolve({ records: [] });
      });

      await import('../../../utils/hygiene-gm-evidence-link');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const sfCalls = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('any(pat IN $patterns'),
      );
      for (const [, params] of sfCalls) {
        expect(params.projectId).toBe('proj_testgm123456');
      }
    });
  });

  // SPEC-GAP: Spec says "one-shot script" but doesn't specify idempotency guarantees — the MERGE ensures replay-safety but this isn't spec'd.
  // SPEC-GAP: The manual GM_EVIDENCE_MAP is hardcoded, not configurable — spec doesn't address extensibility.
});
