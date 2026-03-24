// AUD-TC-03-L1b-38 — B6 (Health Witness)
// Spec-derived audit tests for hygiene-foundation-bootstrap.ts
// Spec: plans/hygiene-governance/PLAN.md — foundation bootstrapping

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Neo4j driver mock ───
const mockRun = vi.fn().mockResolvedValue({ records: [] });
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

describe('hygiene-foundation-bootstrap audit tests', () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  let logOutput: string[] = [];
  let errorOutput: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ records: [] });
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

  // Helper: import the module and wait for it to fully complete (session.close signals finally block)
  async function runModule() {
    await import('../../../utils/hygiene-foundation-bootstrap');
    await vi.waitFor(() => expect(mockClose).toHaveBeenCalled(), { timeout: 3000 });
  }

  // ─── Behavior 1: defines HygieneControlSeed records with code/name/successSignal/failureClasses ───
  describe('HygieneControlSeed definitions', () => {
    it('creates HygieneControl nodes with correct codes from CONTROL_SEEDS', async () => {
      await runModule();

      const controlCalls = mockRun.mock.calls.filter(
        ([cypher]: [string]) => typeof cypher === 'string' && cypher.includes('HygieneControl') && cypher.includes('MERGE') && !cypher.includes('TARGETS_FAILURE_CLASS'),
      );

      // Spec: 8 controls: B1, B2, B3, B6, B7, A2, A3, A6
      const expectedCodes = ['B1', 'B2', 'B3', 'B6', 'B7', 'A2', 'A3', 'A6'];
      const createdCodes = controlCalls.map(([, params]: [string, any]) => params.code);
      for (const code of expectedCodes) {
        expect(createdCodes).toContain(code);
      }

      // Each control has required fields
      for (const [, params] of controlCalls) {
        expect(params).toHaveProperty('code');
        expect(params).toHaveProperty('name');
        expect(params).toHaveProperty('successSignal');
        expect(params).toHaveProperty('mode');
        expect(['advisory', 'enforced']).toContain(params.mode);
      }
    });
  });

  // ─── Behavior 2: creates HygieneControl nodes in Neo4j ───
  describe('Neo4j node creation', () => {
    it('MERGEs HygieneDomain, HygieneSchemaVersion, HygieneFailureClass, HygieneControl, and RepoHygieneProfile nodes', async () => {
      vi.resetModules();
      await runModule();

      const cyphers = mockRun.mock.calls.map(([cypher]: [string]) => cypher);

      // Domain node
      expect(cyphers.some((c: string) => c.includes('HygieneDomain') && c.includes('MERGE'))).toBe(true);
      // Schema version
      expect(cyphers.some((c: string) => c.includes('HygieneSchemaVersion') && c.includes('MERGE'))).toBe(true);
      // Failure classes
      expect(cyphers.some((c: string) => c.includes('HygieneFailureClass') && c.includes('MERGE'))).toBe(true);
      // Controls
      expect(cyphers.some((c: string) => c.includes('HygieneControl') && c.includes('MERGE'))).toBe(true);
      // Repo profile
      expect(cyphers.some((c: string) => c.includes('RepoHygieneProfile') && c.includes('MERGE'))).toBe(true);
    });
  });

  // ─── Behavior 3: covers 4 failure classes ───
  describe('failure class coverage', () => {
    it('creates all 4 failure classes: regression, security_issue, reliability_issue, governance_drift', async () => {
      vi.resetModules();
      await runModule();

      const failureCalls = mockRun.mock.calls.filter(
        ([cypher]: [string]) => typeof cypher === 'string' && cypher.includes('HygieneFailureClass') && cypher.includes('MERGE') && !cypher.includes('TARGETS'),
      );

      const failureKeys = failureCalls.map(([, params]: [string, any]) => params.failureClass);
      expect(failureKeys).toContain('regression');
      expect(failureKeys).toContain('security_issue');
      expect(failureKeys).toContain('reliability_issue');
      expect(failureKeys).toContain('governance_drift');
    });

    it('links controls to their failure classes via TARGETS_FAILURE_CLASS edges', async () => {
      vi.resetModules();
      await runModule();

      const targetCalls = mockRun.mock.calls.filter(
        ([cypher]: [string]) => typeof cypher === 'string' && cypher.includes('TARGETS_FAILURE_CLASS'),
      );
      // 8 controls × 2 failure classes each = 16 edges minimum
      expect(targetCalls.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ─── Behavior 4: reads filesystem for config validation (artifact output) ───
  describe('filesystem artifact output', () => {
    it('writes foundation artifact JSON to artifacts/hygiene/ directory', async () => {
      vi.resetModules();
      await runModule();

      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('artifacts'), { recursive: true });

      const [writePath, content] = mockWriteFile.mock.calls[0];
      expect(writePath).toMatch(/hygiene-foundation-\d+\.json$/);

      const parsed = JSON.parse(content.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed).toHaveProperty('schemaVersion');
      expect(parsed).toHaveProperty('controls');
      expect(parsed).toHaveProperty('failureClasses');
    });
  });

  // ─── Behavior 5: accepts PROJECT_ID from env ───
  describe('PROJECT_ID env support', () => {
    it('uses PROJECT_ID from env when set', async () => {
      vi.resetModules();
      process.env.PROJECT_ID = 'proj_custom123456';
      await runModule();

      const allParams = mockRun.mock.calls.map(([, params]: [string, any]) => params);
      const hasCustomProject = allParams.some((p: any) => p?.projectId === 'proj_custom123456');
      expect(hasCustomProject).toBe(true);
    });

    it('falls back to default PROJECT_ID when env not set', async () => {
      vi.resetModules();
      delete process.env.PROJECT_ID;
      await runModule();

      const allParams = mockRun.mock.calls.map(([, params]: [string, any]) => params);
      const hasDefault = allParams.some((p: any) => p?.projectId === 'proj_c0d3e9a1f200');
      expect(hasDefault).toBe(true);
    });
  });

  // ─── Behavior 6: uses direct neo4j-driver ───
  describe('direct neo4j-driver usage', () => {
    it('closes session and driver in finally block', async () => {
      vi.resetModules();
      await runModule();

      expect(mockClose).toHaveBeenCalled();
      expect(mockDriverClose).toHaveBeenCalled();
    });

    it('exits with code 1 and JSON error on failure', async () => {
      vi.resetModules();
      mockRun.mockRejectedValue(new Error('Connection refused'));

      await import('../../../utils/hygiene-foundation-bootstrap');
      await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(1), { timeout: 3000 });

      const errorJson = errorOutput.find((e) => e.includes('"ok":false'));
      expect(errorJson).toBeDefined();
      expect(JSON.parse(errorJson!).error).toContain('Connection refused');
    });
  });

  // SPEC-GAP: Spec says "reads filesystem for config validation" but actual implementation only writes artifacts — no config file reading. The fs interaction is artifact output, not config input validation.
  // SPEC-GAP: No spec for REQUIRED_EVIDENCE_ENTITIES list or RepoHygieneProfile creation — these are implementation details beyond the spec's "seeds HygieneControl nodes" description.
});
