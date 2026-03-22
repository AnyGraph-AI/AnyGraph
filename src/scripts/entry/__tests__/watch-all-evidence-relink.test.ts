/**
 * watch-all: plan evidence re-linking after code changes
 *
 * Tests for the `reEnrichPlanEvidence` function added in M4.
 * Verifies that after an incremental code parse, HAS_CODE_EVIDENCE edges
 * are re-computed for plan projects that reference the changed code project.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stable mock objects (shared across tests, reset in beforeEach) ───────────

const mockSession = {
  run: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn().mockResolvedValue(undefined),
};

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: { basic: vi.fn(() => ({ scheme: 'basic' })) },
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true) };
});

vi.mock('../../../../src/core/parsers/plan-parser.js', () => ({
  parsePlanDirectory: vi.fn(),
  ingestToNeo4j: vi.fn(),
  enrichCrossDomain: vi.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import neo4j from 'neo4j-driver';
import { existsSync } from 'fs';
import { parsePlanDirectory, enrichCrossDomain } from '../../../../src/core/parsers/plan-parser.js';
import { reEnrichPlanEvidence } from '../watch-all.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLANS_ROOT = '/fake/plans';
const CODE_PID = 'proj_code_001';

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('reEnrichPlanEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore defaults after clearAllMocks
    mockSession.close.mockResolvedValue(undefined);
    mockDriver.close.mockResolvedValue(undefined);
    mockDriver.session.mockReturnValue(mockSession);
    (neo4j as any).driver.mockReturnValue(mockDriver);
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('skips when no PlanProject nodes exist (count = 0 as plain number)', async () => {
    mockSession.run.mockResolvedValue({ records: [{ get: () => 0 }] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(result.skipped).toBe(true);
    expect(result.evidenceEdges).toBe(0);
    expect(parsePlanDirectory).not.toHaveBeenCalled();
    expect(enrichCrossDomain).not.toHaveBeenCalled();
  });

  it('skips when no PlanProject nodes exist (count = 0 as neo4j Integer)', async () => {
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 0 }) }] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(result.skipped).toBe(true);
    expect(parsePlanDirectory).not.toHaveBeenCalled();
  });

  it('skips when plansRoot directory does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 3 }) }] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(result.skipped).toBe(true);
    expect(parsePlanDirectory).not.toHaveBeenCalled();
  });

  it('re-parses plans and calls enrichCrossDomain when plan projects exist', async () => {
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 2 }) }] });

    const fakeParsedPlans = [{ projectId: 'plan_001', nodes: [], edges: [], unresolvedRefs: [] }];
    vi.mocked(parsePlanDirectory).mockResolvedValue(fakeParsedPlans as any);
    vi.mocked(enrichCrossDomain).mockResolvedValue({ resolved: 5, notFound: 0, evidenceEdges: 5, driftDetected: [] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(parsePlanDirectory).toHaveBeenCalledWith(PLANS_ROOT);
    expect(enrichCrossDomain).toHaveBeenCalledWith(
      fakeParsedPlans,
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
    expect(result.skipped).toBe(false);
    expect(result.evidenceEdges).toBe(5);
  });

  it('returns evidenceEdges count from enrichCrossDomain result', async () => {
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 1 }) }] });
    vi.mocked(parsePlanDirectory).mockResolvedValue([{ projectId: 'plan_002', nodes: [], edges: [], unresolvedRefs: [] }] as any);
    vi.mocked(enrichCrossDomain).mockResolvedValue({ resolved: 12, notFound: 3, evidenceEdges: 12, driftDetected: [] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(result.evidenceEdges).toBe(12);
    expect(result.skipped).toBe(false);
  });

  it('passes custom neo4jConfig uri and credentials to driver and enrichCrossDomain', async () => {
    const customConfig = { uri: 'bolt://custom:7687', user: 'admin', password: 'secret' };
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 1 }) }] });
    vi.mocked(parsePlanDirectory).mockResolvedValue([] as any);
    vi.mocked(enrichCrossDomain).mockResolvedValue({ resolved: 0, notFound: 0, evidenceEdges: 0, driftDetected: [] });

    await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT, customConfig);

    expect((neo4j as any).driver).toHaveBeenCalledWith(customConfig.uri, expect.anything());
    expect((neo4j as any).auth.basic).toHaveBeenCalledWith(customConfig.user, customConfig.password);
    expect(enrichCrossDomain).toHaveBeenCalledWith(
      [],
      customConfig.uri,
      customConfig.user,
      customConfig.password,
    );
  });

  it('returns skipped=false and evidenceEdges=0 when enrichCrossDomain finds no new links', async () => {
    mockSession.run.mockResolvedValue({ records: [{ get: () => ({ toNumber: () => 1 }) }] });
    vi.mocked(parsePlanDirectory).mockResolvedValue([{ projectId: 'plan_003', nodes: [], edges: [], unresolvedRefs: [] }] as any);
    vi.mocked(enrichCrossDomain).mockResolvedValue({ resolved: 0, notFound: 5, evidenceEdges: 0, driftDetected: [] });

    const result = await reEnrichPlanEvidence(CODE_PID, PLANS_ROOT);

    expect(result.skipped).toBe(false);
    expect(result.evidenceEdges).toBe(0);
  });
});
