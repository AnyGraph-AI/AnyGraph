/**
 * AUD-TC-03-L1b-42: hygiene-proof-scope-sync.ts audit tests
 * Role: B6 (Health Witness)
 *
 * Spec: plans/hygiene-governance/PLAN.md proof scope tracking
 *
 * Behaviors:
 *   (1) defines CRITICAL_MILESTONE_SELECTORS (GM-*, DL-*, HY-14..HY-17)
 *   (2) MERGEs ProofOfDoneScope nodes with version/milestone selectors
 *   (3) uses direct neo4j-driver
 *   (4) accepts PROJECT_ID from env
 *   (5) reports sync counts
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
  await import('../../../utils/hygiene-proof-scope-sync.js');
  await new Promise((r) => setTimeout(r, 100));
}

describe('hygiene-proof-scope-sync audit tests (L1b-42)', () => {
  // ─── B1: defines CRITICAL_MILESTONE_SELECTORS ───
  describe('B1: defines CRITICAL_MILESTONE_SELECTORS', () => {
    it('includes GM- and DL- prefixes', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope') && String(c[0]).includes('MERGE'),
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const selectors = params.criticalMilestoneSelectors as string[];
      expect(selectors).toContain('GM-');
      expect(selectors).toContain('DL-');
    });

    it('includes HY-14 through HY-17', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const selectors = params.criticalMilestoneSelectors as string[];
      expect(selectors).toContain('HY-14');
      expect(selectors).toContain('HY-15');
      expect(selectors).toContain('HY-16');
      expect(selectors).toContain('HY-17');
    });

    it('includes HY-18 and AIH-15..AIH-19 selectors', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const selectors = params.criticalMilestoneSelectors as string[];
      expect(selectors).toContain('HY-18');
      expect(selectors).toContain('AIH-15');
      expect(selectors).toContain('AIH-19');
    });
  });

  // ─── B2: MERGEs ProofOfDoneScope nodes ───
  describe('B2: MERGEs ProofOfDoneScope nodes', () => {
    it('uses MERGE with CodeNode:ProofOfDoneScope labels', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope') && String(c[0]).includes('MERGE'),
      );
      expect(mergeCalls.length).toBeGreaterThan(0);
      const cypher = String(mergeCalls[0][0]);
      expect(cypher).toContain('CodeNode:ProofOfDoneScope');
    });

    it('sets scopeVersion to v1', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.scopeVersion).toBe('v1');
    });

    it('includes requiredEvidenceClasses array', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const classes = params.requiredEvidenceClasses as string[];
      expect(classes).toContain('HAS_CODE_EVIDENCE');
      expect(classes).toContain('VerificationRun');
      expect(classes).toContain('GateDecision');
    });

    it('includes negativeRules array', async () => {
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      const rules = params.negativeRules as string[];
      expect(rules).toContain('plan_only_evidence_insufficient_for_critical_done');
      expect(rules).toContain('code_only_without_runtime_or_governance_evidence_insufficient_for_promotion');
    });

    it('links to HygieneDomain via DEFINES_PROOF_SCOPE edge', async () => {
      await runModule();

      const domainCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('DEFINES_PROOF_SCOPE'),
      );
      expect(domainCalls.length).toBeGreaterThan(0);
    });

    it('links to HygieneControl B1 via APPLIES_TO edge', async () => {
      await runModule();

      const controlCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('APPLIES_TO') && String(c[0]).includes('HygieneControl'),
      );
      expect(controlCalls.length).toBeGreaterThan(0);
    });
  });

  // ─── B3: uses direct neo4j-driver ───
  describe('B3: uses direct neo4j-driver', () => {
    it('closes session and driver in finally block', async () => {
      await runModule();
      expect(mockSessionClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });
  });

  // ─── B4: accepts PROJECT_ID from env ───
  describe('B4: accepts PROJECT_ID from env', () => {
    it('uses custom PROJECT_ID in scope ID and params', async () => {
      process.env.PROJECT_ID = 'proj_proof_test';
      await runModule();

      const mergeCalls = mockSessionRun.mock.calls.filter(
        (c: any[]) => String(c[0]).includes('ProofOfDoneScope'),
      );
      const params = mergeCalls[0][1] as Record<string, unknown>;
      expect(params.projectId).toBe('proj_proof_test');
      expect(String(params.id)).toContain('proj_proof_test');
    });
  });

  // ─── B5: reports sync counts ───
  describe('B5: reports sync counts', () => {
    it('outputs JSON with ok, projectId, scopeId, scopeVersion, selectors, classes, rules', async () => {
      await runModule();

      const jsonCall = mockLog.mock.calls.find((c) => {
        try { return JSON.parse(String(c[0])).ok !== undefined; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const parsed = JSON.parse(String(jsonCall![0]));
      expect(parsed.ok).toBe(true);
      expect(parsed.projectId).toBeTruthy();
      expect(parsed.scopeId).toBeTruthy();
      expect(parsed.scopeVersion).toBe('v1');
      expect(Array.isArray(parsed.criticalMilestoneSelectors)).toBe(true);
      expect(Array.isArray(parsed.requiredEvidenceClasses)).toBe(true);
      expect(Array.isArray(parsed.negativeRules)).toBe(true);
    });
  });

  // SPEC-GAP: Spec doesn't define the exact REQUIRED_EVIDENCE_CLASSES list — implementation adds 6 classes
  // SPEC-GAP: Spec doesn't define NEGATIVE_RULES — implementation adds 2 rules
});
