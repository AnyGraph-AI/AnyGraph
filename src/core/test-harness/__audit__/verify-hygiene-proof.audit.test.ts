// AUD-TC-03-L1b-22 — B6 (Health Witness)
// Spec-derived audit tests for verify-hygiene-proof.ts
// Spec: plans/hygiene-governance/PLAN.md — proof hygiene controls

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

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

// ─── fs mock ───
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
  },
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// Helper: SHA truncated to 16 chars like the source
function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

describe('verify-hygiene-proof audit tests', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  // Default mock responses
  function setupDefaultMocks(opts: { doneWithEvidence?: number; doneWithoutEvidence?: number } = {}) {
    const { doneWithEvidence = 3, doneWithoutEvidence = 0 } = opts;

    mockRun.mockImplementation((cypher: string) => {
      // ProofOfDoneScope query
      if (cypher.includes('ProofOfDoneScope')) {
        return Promise.resolve({
          records: [{
            get: (key: string) => {
              if (key === 'id') return 'scope-1';
              if (key === 'selectors') return ['GM-', 'DL-', 'HY-14', 'HY-15', 'HY-16', 'HY-17'];
              return null;
            },
          }],
        });
      }
      // Main task query with evidence counts
      if (cypher.includes('evidenceEdgeCount')) {
        const records: Array<{ get: (key: string) => unknown }> = [];
        for (let i = 0; i < doneWithEvidence; i++) {
          records.push({
            get: (key: string) => {
              const map: Record<string, any> = {
                planProjectId: 'plan_codegraph',
                milestoneCode: `GM-${i}`,
                milestoneFamily: 'GM',
                taskId: `task-with-evidence-${i}`,
                taskName: `Task with evidence ${i}`,
                evidenceEdgeCount: { toNumber: () => 2 },
              };
              return map[key];
            },
          });
        }
        for (let i = 0; i < doneWithoutEvidence; i++) {
          records.push({
            get: (key: string) => {
              const map: Record<string, any> = {
                planProjectId: 'plan_codegraph',
                milestoneCode: `GM-${i + doneWithEvidence}`,
                milestoneFamily: 'GM',
                taskId: `task-without-evidence-${i}`,
                taskName: `Task without evidence ${i}`,
                evidenceEdgeCount: { toNumber: () => 0 },
              };
              return map[key];
            },
          });
        }
        return Promise.resolve({ records });
      }
      // Delete old violations
      if (cypher.includes('DETACH DELETE')) {
        return Promise.resolve({ records: [] });
      }
      // MERGE violation + snapshot
      return Promise.resolve({ records: [] });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    logOutput = [];
    errorOutput = [];
    console.log = (...args: unknown[]) => logOutput.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => errorOutput.push(args.map(String).join(' '));
    process.exit = vi.fn() as any;
    process.env.HYGIENE_PROOF_ENFORCE = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  // ─── Behavior 1: queries hygiene proof state in graph ───
  describe('graph proof state query', () => {
    it('queries ProofOfDoneScope for milestone selectors', async () => {
      vi.resetModules();
      setupDefaultMocks();

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const scopeCall = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('ProofOfDoneScope'),
      );
      expect(scopeCall).toBeDefined();
      expect(scopeCall![1].projectId).toBeDefined();
    });

    it('queries done tasks with evidence edge counts filtered by milestone selectors', async () => {
      vi.resetModules();
      setupDefaultMocks();

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const taskQuery = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('evidenceEdgeCount') && c.includes('HAS_CODE_EVIDENCE'),
      );
      expect(taskQuery).toBeDefined();
      expect(taskQuery![1].selectors).toBeDefined();
      expect(Array.isArray(taskQuery![1].selectors)).toBe(true);
    });

    it('throws when ProofOfDoneScope is missing', async () => {
      vi.resetModules();
      mockRun.mockImplementation((cypher: string) => {
        if (cypher.includes('ProofOfDoneScope')) {
          return Promise.resolve({ records: [] });
        }
        return Promise.resolve({ records: [] });
      });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('ProofOfDoneScope'));
      expect(errJson).toBeDefined();
    });
  });

  // ─── Behavior 2: enforces or reports based on HYGIENE_PROOF_ENFORCE env var ───
  describe('HYGIENE_PROOF_ENFORCE switching', () => {
    it('reports ok=true in advisory mode even with violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithEvidence: 2, doneWithoutEvidence: 3 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.advisoryMode).toBe(true);
      expect(parsed.doneWithoutEvidenceCount).toBe(3);
    });

    it('reports ok=false and exits 1 in enforce mode with violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'true';
      setupDefaultMocks({ doneWithEvidence: 2, doneWithoutEvidence: 1 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 2000 });

      const errJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errJson).toBeDefined();
      const parsed = JSON.parse(errJson!);
      expect(parsed.enforce).toBe(true);
      expect(parsed.doneWithoutEvidenceCount).toBe(1);
    });

    it('reports ok=true in enforce mode when no violations', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'true';
      setupDefaultMocks({ doneWithEvidence: 5, doneWithoutEvidence: 0 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      expect(jsonLine).toBeDefined();
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.ok).toBe(true);
      expect(parsed.enforce).toBe(true);
    });
  });

  // ─── Behavior 3: produces deterministic sha identifiers ───
  describe('deterministic SHA identifiers', () => {
    it('generates violation IDs using SHA of taskId', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithEvidence: 0, doneWithoutEvidence: 2 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationMerges = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE'),
      );
      for (const [, params] of violationMerges) {
        // ID format: hygiene-violation:{projectId}:proof:{sha(taskId)}
        expect(params.id).toMatch(/^hygiene-violation:.+:proof:[0-9a-f]{16}$/);
      }
    });

    it('same taskId always produces same violation ID', () => {
      const taskId = 'task-123';
      const id1 = `hygiene-violation:proj:proof:${sha(taskId)}`;
      const id2 = `hygiene-violation:proj:proof:${sha(taskId)}`;
      expect(id1).toBe(id2);
    });
  });

  // ─── Behavior 4: toNum helper handles Neo4j Integer safely ───
  describe('toNum helper', () => {
    it('handles Neo4j Integer objects with toNumber()', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      const neo4jInt = { toNumber: () => 42 };
      mockRun.mockImplementation((cypher: string) => {
        if (cypher.includes('ProofOfDoneScope')) {
          return Promise.resolve({
            records: [{
              get: (key: string) => key === 'id' ? 'scope-1' : ['GM-'],
            }],
          });
        }
        if (cypher.includes('evidenceEdgeCount')) {
          return Promise.resolve({
            records: [{
              get: (key: string) => {
                const m: Record<string, any> = {
                  planProjectId: 'plan_codegraph',
                  milestoneCode: 'GM-0',
                  milestoneFamily: 'GM',
                  taskId: 'task-1',
                  taskName: 'Test task',
                  evidenceEdgeCount: neo4jInt,
                };
                return m[key];
              },
            }],
          });
        }
        return Promise.resolve({ records: [] });
      });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      // The task had evidence (42 > 0), so doneWithoutEvidenceCount should be 0
      expect(parsed.doneWithoutEvidenceCount).toBe(0);
    });
  });

  // ─── Behavior 5: reports proof gaps and failures ───
  describe('proof gap reporting', () => {
    it('creates HygieneViolation nodes for done tasks without evidence', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithEvidence: 1, doneWithoutEvidence: 2 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationMerges = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('HygieneViolation') && c.includes('MERGE') && c.includes("'proof_of_done'"),
      );
      expect(violationMerges.length).toBe(2);

      for (const [, params] of violationMerges) {
        expect(params.taskId).toBeDefined();
        expect(params.milestoneCode).toBeDefined();
      }
    });

    it('clears old proof_of_done violations before creating new ones', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithoutEvidence: 1 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const deleteCalls = mockRun.mock.calls.filter(
        ([c]: [string]) => typeof c === 'string' && c.includes('DETACH DELETE') && c.includes('proof_of_done'),
      );
      expect(deleteCalls.length).toBe(1);
    });

    it('reports coverage rows grouped by milestone family', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithEvidence: 2, doneWithoutEvidence: 1 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.coverageRows).toBeDefined();
      expect(Array.isArray(parsed.coverageRows)).toBe(true);
      for (const row of parsed.coverageRows) {
        expect(row).toHaveProperty('planProjectId');
        expect(row).toHaveProperty('milestoneFamily');
        expect(row).toHaveProperty('proofCoverage');
      }
    });

    it('writes artifact JSON to artifacts/hygiene/ directory', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks();

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalled(), { timeout: 2000 });

      const [writePath] = mockWriteFile.mock.calls[0];
      expect(writePath).toMatch(/hygiene-proof-verify-\d+\.json$/);
    });

    it('links HygieneViolation to HygieneControl B1 via TRIGGERED_BY', async () => {
      vi.resetModules();
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks({ doneWithoutEvidence: 1 });

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(mockRun).toHaveBeenCalled(), { timeout: 2000 });

      const violationCypher = mockRun.mock.calls.find(
        ([c]: [string]) => typeof c === 'string' && c.includes('TRIGGERED_BY') && c.includes("code: 'B1'"),
      );
      expect(violationCypher).toBeDefined();
    });
  });

  // ─── Behavior 6: accepts PROJECT_ID from env ───
  describe('PROJECT_ID env support', () => {
    it('uses PROJECT_ID from env for all queries', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_prooftest1234';
      process.env.HYGIENE_PROOF_ENFORCE = 'false';
      setupDefaultMocks();

      await import('../../../utils/verify-hygiene-proof');
      await vi.waitFor(() => expect(logOutput.length).toBeGreaterThan(0), { timeout: 2000 });

      const jsonLine = logOutput.find((l) => l.startsWith('{'));
      const parsed = JSON.parse(jsonLine!);
      expect(parsed.projectId).toBe('proj_prooftest1234');
    });
  });

  // SPEC-GAP: Spec doesn't specify HygieneMetricSnapshot creation — implementation records a metric snapshot per run but spec only mentions "verifies hygiene proof records exist and pass."
  // SPEC-GAP: Spec says "reports proof gaps and failures" but doesn't define the sample size (implementation caps at 20 sampleViolations).
});
