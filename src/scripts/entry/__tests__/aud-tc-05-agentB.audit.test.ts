// Spec source: plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md, plans/codegraph/PLAN.md
//
// AUD-TC-05 Agent B — Entry Points Audit (Enrichment / Gate / Diagnostics)
//
// Spec-derived tests for:
//   L1-01: enforce-edit.ts       — 12 behavioral assertions (spec requires 11+)
//   L1-05: precompute-scores.ts  —  7 behavioral assertions
//   L1-06: rebuild-derived.ts    —  7 behavioral assertions
//   L1-07: refresh-hypotheses.ts —  6 behavioral assertions
//   L1-09: test-graph-integrity.ts — 6 behavioral assertions
//
// ⚠️  All five entry points call main() at module top-level (no exports).
//     Tests use vi.resetModules() + dynamic import per the CORRECTIONS.md directive.
//
// FINDINGS:
//   FIND-05-01 [LOW] — rebuild-derived.ts: Spec §GC-9 says "exits with error code on
//     failure." Implementation uses best-effort rebuild: individual execSync failures are
//     caught and logged, and main() uses .catch(console.error) (exits 0). The process only
//     exits non-zero if a Neo4j session operation throws before the execSync loop.
//     Recommendation: add process.exit(1) to .catch handler and/or after individual
//     script failures.
//   FIND-05-02 [LOW] — test-graph-integrity.ts: Spec says "closes driver in finally block."
//     Implementation calls driver.close() at the end of main() body (not inside a finally).
//     A thrown error inside a query() call will skip driver.close(), leaking the connection.
//     Recommendation: wrap body of main() in try/finally and move driver.close() to finally.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stable vi.fn() instances (reused across vi.resetModules cycles) ──────────

// Raw neo4j-driver mocks
const mockSessionRun = vi.fn();
const mockSessionClose = vi.fn();
const mockDriverSession = vi.fn();
const mockDriverClose = vi.fn();
const mockNeo4jDriverCtor = vi.fn(() => ({
  session: mockDriverSession,
  close: mockDriverClose,
}));

// Neo4jService mocks (for enforce-edit + refresh-hypotheses)
const mockNeo4jRun = vi.fn();
const mockNeo4jClose = vi.fn();

// enforcement-gate mock
const mockEvaluateGate = vi.fn();

// graph-resolver mocks
const mockResolveAffected = vi.fn();
const mockResolveBlast = vi.fn();

// enrichPrecomputeScores mock
const mockEnrichScores = vi.fn();

// IntegrityHypothesisGenerator method mocks
const mockGenerate = vi.fn();
const mockGetOpen = vi.fn();

// child_process mock
const mockExecSync = vi.fn();

// ─── vi.mock registrations (hoisted before all imports) ──────────────────────

vi.mock('neo4j-driver', () => ({
  default: {
    driver: mockNeo4jDriverCtor,
    auth: { basic: vi.fn(() => ({ scheme: 'basic' })) },
  },
}));

// dotenv — used by test-graph-integrity.ts and enforce-edit (dotenv/config)
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

vi.mock('dotenv/config', () => ({}));

// Neo4jService — used by enforce-edit + refresh-hypotheses
// Must use a regular function (not arrow) so it is valid as a constructor with `new`
vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: vi.fn(function MockNeo4jService(this: Record<string, unknown>) {
    this.run = mockNeo4jRun;
    this.close = mockNeo4jClose;
  }),
}));

// enforcement-gate — used by enforce-edit
vi.mock('../../../core/enforcement/enforcement-gate.js', () => ({
  evaluateEnforcementGate: mockEvaluateGate,
  DEFAULT_CONFIG: {
    mode: 'advisory' as const,
    blockOnCritical: true,
    requireApprovalOnHigh: true,
    maxWaiverDurationMs: 3_600_000,
    requiresJustification: false,
  },
}));

// graph-resolver — used by enforce-edit
vi.mock('../../../core/enforcement/graph-resolver.js', () => ({
  resolveAffectedNodes: mockResolveAffected,
  resolveBlastRadius: mockResolveBlast,
}));

// precompute-scores enrichment — used by precompute-scores entry
vi.mock('../../enrichment/precompute-scores.js', () => ({
  enrichPrecomputeScores: mockEnrichScores,
}));

// IntegrityHypothesisGenerator — used by refresh-hypotheses
// Must use a regular function (not arrow) so it is valid as a constructor with `new`
vi.mock('../../../core/ground-truth/integrity-hypothesis-generator.js', () => ({
  IntegrityHypothesisGenerator: vi.fn(function MockGenerator(this: Record<string, unknown>) {
    this.generateFromDiscrepancies = mockGenerate;
    this.getOpenIntegrityHypotheses = mockGetOpen;
  }),
}));

// child_process — used by rebuild-derived
vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build a synthetic EnforcementResult */
function makeGateResult(
  decision: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL',
  untestedCritical = 0,
) {
  return {
    decision,
    reason: `Test gate decision: ${decision}`,
    affectedNodes: [],
    riskSummary: {
      totalAffected: 3,
      criticalCount: 1,
      highCount: 0,
      untestedCriticalCount: untestedCritical,
      maxCompositeRisk: 65,
    },
    approvalRequired:
      decision === 'REQUIRE_APPROVAL'
        ? {
            reason: 'High-risk functions affected',
            requiredApprover: 'human' as const,
            affectedCriticalNodes: ['fn_critical_1'],
            expiresAt: undefined,
          }
        : undefined,
    decisionHash: 'testhash_abc123',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a Neo4j record stub with .keys + .get() for use in session.run results.
 * test-graph-integrity.ts iterates r.keys and calls r.get(k).
 */
function makeRecord(fields: Record<string, unknown>) {
  return {
    keys: Object.keys(fields),
    get: (k: string): unknown => (k in fields ? fields[k] : null),
  };
}

/**
 * Default record for test-graph-integrity queries.
 * Values are chosen so that "expects === 0" invariants PASS
 * and "expects > 0" / ">= N" threshold checks FAIL (caught by B5 test).
 */
function makeIntegrityRecord() {
  return makeRecord({
    cnt: 0,          // triggers failures for Grammy/dynamic/barrel/conditional checks
    dupes: 0,        // passes "no duplicates" invariant
    pct: 50,         // triggers failure for resolution rate check (expects >= 80)
    total: 100,
    resolved: 50,
    callerCount: 0,  // triggers failure for dependency chain check
    risk: 10,
    tier: 'LOW',     // triggers failure for createBot CRITICAL tier check
    fanOut: 0,
    lines: 10,
    fanIn: 0,
  });
}

/** Build a neo4j Integer-like object (with .toNumber()) */
function neo4jInt(n: number) {
  return { low: n, high: 0, toNumber: () => n };
}

/** Flush pending microtasks and macrotasks introduced by async module code */
const flushAsync = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 50));

// ─── State shared across tests ────────────────────────────────────────────────

const originalArgv = [...process.argv];
let exitSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

// ─── Global before/afterEach ──────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  process.argv = [...originalArgv];

  // Prevent real process.exit from terminating the test runner
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(
    (_code?: number): never => undefined as never,
  );

  // Suppress noisy console output while preserving spy access
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // ── Raw neo4j-driver defaults ──
  mockNeo4jDriverCtor.mockClear();
  const sessionStub = { run: mockSessionRun, close: mockSessionClose };
  mockDriverSession.mockReset().mockReturnValue(sessionStub);
  mockSessionRun.mockReset().mockResolvedValue({ records: [] });
  mockSessionClose.mockReset().mockResolvedValue(undefined);
  mockDriverClose.mockReset().mockResolvedValue(undefined);

  // ── Neo4jService defaults ──
  mockNeo4jRun.mockReset().mockResolvedValue([]);
  mockNeo4jClose.mockReset().mockResolvedValue(undefined);

  // ── Gate + resolver defaults ──
  mockEvaluateGate.mockReset().mockReturnValue(makeGateResult('ALLOW'));
  mockResolveAffected.mockReset().mockResolvedValue([]);
  mockResolveBlast.mockReset().mockResolvedValue([]);

  // ── Enrichment defaults ──
  mockEnrichScores.mockReset().mockResolvedValue({ functionsUpdated: 5, filesUpdated: 2 });

  // ── Hypothesis defaults ──
  mockGenerate.mockReset().mockResolvedValue([]);
  mockGetOpen.mockReset().mockResolvedValue([]);

  // ── execSync default: succeed silently ──
  mockExecSync.mockReset();
});

afterEach(() => {
  process.argv = [...originalArgv];
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-01: enforce-edit.ts
// Spec: VERIFICATION_GRAPH_ROADMAP.md §8 Edit/CI Gating Policy
//       PLAN.md §Phase 3 pre-edit gate
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-01] enforce-edit.ts — RF-2 Enforcement Gate CLI', () => {
  // Convenience: build process.argv for enforce-edit
  const argv = (...args: string[]) => {
    process.argv = ['node', 'enforce-edit.js', ...args];
  };

  it('(B2) instantiates Neo4jService to connect to Neo4j', async () => {
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    // Neo4jService.run called means the service was instantiated and used
    expect(mockNeo4jRun).toHaveBeenCalled();
  });

  it('(B1+B3) resolves affected nodes with the provided file paths', async () => {
    argv('/workspace/src/foo.ts', '/workspace/src/bar.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockResolveAffected).toHaveBeenCalledWith(
      expect.anything(), // Neo4jService instance
      expect.arrayContaining([
        expect.stringContaining('foo.ts'),
        expect.stringContaining('bar.ts'),
      ]),
      expect.any(String), // projectId
    );
  });

  it('(B4) evaluates gate with default advisory mode when --mode not specified', async () => {
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockEvaluateGate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'advisory' }),
      expect.any(Array),
    );
  });

  it('(B1) parses --mode flag and passes it to evaluateEnforcementGate', async () => {
    argv('/src/foo.ts', '--mode', 'enforced');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockEvaluateGate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'enforced' }),
      expect.any(Array),
    );
  });

  it('(B1) parses --project-id and passes it to resolveAffectedNodes', async () => {
    argv('/src/foo.ts', '--project-id', 'proj_custom_99');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockResolveAffected).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      'proj_custom_99',
    );
  });

  it('(B5) outputs JSON with decision field when --json flag is present', async () => {
    argv('/src/foo.ts', '--json');
    await import('../enforce-edit.js');
    await flushAsync();
    const jsonCall = consoleLogSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && (call[0] as string).trim().startsWith('{'),
    );
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed).toHaveProperty('decision');
  });

  it('(B6) outputs human-readable summary with decision icon when no --json', async () => {
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    // Must contain one of the three status icons
    expect(output).toMatch(/[✅🚫⚠️]/u);
  });

  it('(B7) reports untested CRITICAL count when untestedCriticalCount > 0', async () => {
    mockEvaluateGate.mockReturnValue(makeGateResult('ALLOW', 3));
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/3.*CRITICAL|CRITICAL.*NO test/i);
  });

  it('(B8) calls resolveBlastRadius when --blast-radius flag is present', async () => {
    argv('/src/foo.ts', '--blast-radius');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockResolveBlast).toHaveBeenCalled();
  });

  it('(B9) queries policy diagnostics passing filePaths in params', async () => {
    argv('/src/some-config.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    // neo4j.run was invoked for policy diagnostics (configRiskClass, productionRiskExcluded)
    expect(mockNeo4jRun).toHaveBeenCalled();
    // The params object must carry the filePaths list (not asserting on Cypher text)
    const firstCallParams = mockNeo4jRun.mock.calls[0][1] as Record<string, unknown>;
    expect(firstCallParams).toHaveProperty('filePaths');
    expect(Array.isArray(firstCallParams.filePaths)).toBe(true);
  });

  it('(B10) exits with code 1 on BLOCK decision', async () => {
    mockEvaluateGate.mockReturnValue(makeGateResult('BLOCK'));
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    // First call to process.exit must be with code 1 (BLOCK)
    expect(exitSpy).toHaveBeenCalled();
    expect(exitSpy.mock.calls[0][0]).toBe(1);
  });

  it('(B10) exits with code 0 on ALLOW decision', async () => {
    mockEvaluateGate.mockReturnValue(makeGateResult('ALLOW'));
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    // process.exit(0) is the last exit call for ALLOW
    const exitCodes = exitSpy.mock.calls.map((c) => c[0]);
    expect(exitCodes).toContain(0);
    // Must NOT have exit(1) as first call
    expect(exitCodes[0]).toBe(0);
  });

  it('(B11) closes Neo4j connection via finally block', async () => {
    argv('/src/foo.ts');
    await import('../enforce-edit.js');
    await flushAsync();
    expect(mockNeo4jClose).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-05: precompute-scores.ts
// Spec: VERIFICATION_GRAPH_ROADMAP.md §28 RF-14 — thin orchestrator composing
//       enrichPrecomputeScores()
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-05] precompute-scores.ts — RF-14 Score Precompute Orchestrator', () => {
  it('(B1) connects to Neo4j via raw neo4j-driver on startup', async () => {
    process.argv = ['node', 'precompute-scores.js'];
    // Provide a valid projects result so the loop completes
    mockSessionRun.mockResolvedValueOnce({ records: [] });
    await import('../precompute-scores.js');
    await flushAsync();
    expect(mockNeo4jDriverCtor).toHaveBeenCalled();
  });

  it('(B2+B3) when projectId CLI arg given, runs enrichment for that project only', async () => {
    process.argv = ['node', 'precompute-scores.js', 'proj_specific_42'];
    await import('../precompute-scores.js');
    await flushAsync();
    expect(mockEnrichScores).toHaveBeenCalledTimes(1);
    expect(mockEnrichScores).toHaveBeenCalledWith(expect.anything(), 'proj_specific_42');
  });

  it('(B2+B4) when no projectId arg, queries graph for all Project nodes', async () => {
    process.argv = ['node', 'precompute-scores.js'];
    // Return 2 discovered projects
    mockSessionRun.mockResolvedValueOnce({
      records: [
        makeRecord({ projectId: 'proj_aaa', name: 'Alpha' }),
        makeRecord({ projectId: 'proj_bbb', name: 'Beta' }),
      ],
    });
    await import('../precompute-scores.js');
    await flushAsync();
    // session.run was called to discover projects (no projectId arg path)
    expect(mockSessionRun).toHaveBeenCalled();
  });

  it('(B5) iterates over all discovered projects and runs enrichment for each', async () => {
    process.argv = ['node', 'precompute-scores.js'];
    mockSessionRun.mockResolvedValueOnce({
      records: [
        makeRecord({ projectId: 'proj_one', name: 'One' }),
        makeRecord({ projectId: 'proj_two', name: 'Two' }),
      ],
    });
    await import('../precompute-scores.js');
    await flushAsync();
    expect(mockEnrichScores).toHaveBeenCalledTimes(2);
    expect(mockEnrichScores).toHaveBeenCalledWith(expect.anything(), 'proj_one');
    expect(mockEnrichScores).toHaveBeenCalledWith(expect.anything(), 'proj_two');
  });

  it('(B6) reports functionsUpdated and filesUpdated per project', async () => {
    process.argv = ['node', 'precompute-scores.js', 'proj_report_test'];
    mockEnrichScores.mockResolvedValueOnce({ functionsUpdated: 42, filesUpdated: 7 });
    await import('../precompute-scores.js');
    await flushAsync();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/42.*functions?|functions?.*42/i);
    expect(output).toMatch(/7.*files?|files?.*7/i);
  });

  it('(B7) closes driver in finally block regardless of outcome', async () => {
    process.argv = ['node', 'precompute-scores.js', 'proj_close_test'];
    await import('../precompute-scores.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });

  it('(B7) closes driver even when enrichPrecomputeScores throws', async () => {
    process.argv = ['node', 'precompute-scores.js', 'proj_error_test'];
    mockEnrichScores.mockRejectedValueOnce(new Error('enrichment failed'));
    await import('../precompute-scores.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-06: rebuild-derived.ts
// Spec: PLAN.md §GC-9 — delete all derived edges/properties, re-run enrichment
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-06] rebuild-derived.ts — GC-9 Derived Data Rebuild', () => {
  /**
   * Set up session.run responses for the three sequential Neo4j operations
   * in rebuild-derived.ts main():
   *   1. Count derived edges before deletion (returns array of {type, cnt})
   *   2. Delete derived edges (returns {deleted: N})
   *   3. Clear derived properties (returns {cleared: N})
   *   4. After execSync loop: count derived edges again (returns array of {type, cnt})
   */
  function setupSessionForRebuild(opts: {
    derivedEdgeCount?: number;
    deletedCount?: number;
    clearedCount?: number;
  } = {}) {
    const { derivedEdgeCount = 50, deletedCount = 50, clearedCount = 10 } = opts;

    const edgeCountRecords = derivedEdgeCount > 0
      ? [makeRecord({ edgeType: 'CALLS', cnt: neo4jInt(derivedEdgeCount) })]
      : [];

    mockSessionRun
      // Step 1: before-count
      .mockResolvedValueOnce({ records: edgeCountRecords })
      // Step 2: delete derived edges
      .mockResolvedValueOnce({
        records: [makeRecord({ deleted: neo4jInt(deletedCount) })],
      })
      // Step 3: clear derived properties
      .mockResolvedValueOnce({
        records: [makeRecord({ cleared: neo4jInt(clearedCount) })],
      })
      // Step 5: after-count (second session)
      .mockResolvedValueOnce({ records: [] });
  }

  it('(B1) creates a neo4j driver connection on startup', async () => {
    setupSessionForRebuild();
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    expect(mockNeo4jDriverCtor).toHaveBeenCalled();
  });

  it('(B2) deletes all edges where derived=true via session.run', async () => {
    setupSessionForRebuild({ deletedCount: 73 });
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    // session.run must have been called for the delete operation
    const calls = mockSessionRun.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2); // at least before-count + delete
  });

  it('(B3) clears derived properties on Function nodes via session.run', async () => {
    setupSessionForRebuild({ clearedCount: 15 });
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    const calls = mockSessionRun.mock.calls;
    // Three operations before execSync loop: before-count, delete, clear-props
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('(B4) re-runs enrichment scripts in dependency order via execSync', async () => {
    setupSessionForRebuild();
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    expect(mockExecSync).toHaveBeenCalled();
    // Scripts must include core enrichment steps (dependency order)
    const calledScripts = mockExecSync.mock.calls.map(
      (c) => String(c[0] ?? ''),
    );
    const hasTemporalCoupling = calledScripts.some((s) =>
      s.includes('enrich:temporal-coupling'),
    );
    const hasCompositeRisk = calledScripts.some((s) =>
      s.includes('enrich:composite-risk'),
    );
    expect(hasTemporalCoupling).toBe(true);
    expect(hasCompositeRisk).toBe(true);
  });

  it('(B5) reports counts of deleted edges and cleared properties', async () => {
    setupSessionForRebuild({ deletedCount: 88, clearedCount: 22 });
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/88.*derived|Deleted.*88/i);
    expect(output).toMatch(/22.*functions?|Cleared.*22/i);
  });

  it('(B6) completes without calling process.exit on successful run', async () => {
    setupSessionForRebuild();
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    // On success, main() resolves cleanly — process.exit is NOT called
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('(B7/FIND-05-01) driver.close() called in finally even when Neo4j operation throws', async () => {
    // FIND-05-01 note: spec says "exits with error code on failure" but
    // implementation does best-effort rebuild. However, driver.close() IS in finally.
    mockSessionRun.mockRejectedValueOnce(new Error('Neo4j connection refused'));
    process.argv = ['node', 'rebuild-derived.js'];
    await import('../rebuild-derived.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-07: refresh-hypotheses.ts
// Spec: Claims/Reasoning layer — hypothesis refresh via IntegrityHypothesisGenerator
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-07] refresh-hypotheses.ts — Integrity Hypothesis Refresh', () => {
  it('(B1) connects to Neo4j via Neo4jService', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    await import('../refresh-hypotheses.js');
    await flushAsync();
    // Neo4jService.close() being called proves it was instantiated
    expect(mockNeo4jClose).toHaveBeenCalled();
  });

  it('(B2) calls generateFromDiscrepancies() with hardcoded project scope proj_c0d3e9a1f200', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    await import('../refresh-hypotheses.js');
    await flushAsync();
    expect(mockGenerate).toHaveBeenCalledWith('proj_c0d3e9a1f200');
  });

  it('(B3) calls generateFromDiscrepancies() with no argument for global scope', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    await import('../refresh-hypotheses.js');
    await flushAsync();
    // Second call is the global (no-argument) invocation
    expect(mockGenerate).toHaveBeenCalledWith();
    // Both calls present: project-scoped + global
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('(B4) reports open hypothesis count via getOpenIntegrityHypotheses()', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    mockGetOpen.mockResolvedValueOnce([
      { name: 'HYP-001: missing coverage' },
      { name: 'HYP-002: stale verification' },
    ]);
    await import('../refresh-hypotheses.js');
    await flushAsync();
    expect(mockGetOpen).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/open.*hypothes|2.*open/i);
  });

  it('(B5) closes Neo4j in finally block after successful run', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    await import('../refresh-hypotheses.js');
    await flushAsync();
    expect(mockNeo4jClose).toHaveBeenCalled();
  });

  it('(B6) exits with code 1 on error (e.g., generateFromDiscrepancies throws)', async () => {
    process.argv = ['node', 'refresh-hypotheses.js'];
    mockGenerate.mockRejectedValueOnce(new Error('graph unavailable'));
    await import('../refresh-hypotheses.js');
    await flushAsync();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// L1-09: test-graph-integrity.ts
// Spec: PLAN.md §Extension 9 — graph integrity test harness
// ═══════════════════════════════════════════════════════════════════════════════

describe('[L1-09] test-graph-integrity.ts — Graph Integrity Test Harness', () => {
  /**
   * Set up the neo4j session mock for integrity query calls.
   * Each call to driver.session() returns a fresh stub with run that returns
   * a universal record covering all field shapes used by the harness.
   */
  function setupIntegritySession() {
    const sessionStub = {
      run: vi.fn().mockResolvedValue({
        records: [makeIntegrityRecord()],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockDriverSession.mockReturnValue(sessionStub);
    return sessionStub;
  }

  it('(B1) creates neo4j driver connection at module load time', async () => {
    setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    // driver = neo4j.driver(...) runs synchronously at module level
    expect(mockNeo4jDriverCtor).toHaveBeenCalled();
  });

  it('(B2) executes multiple graph queries for structural invariants', async () => {
    const session = setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    // The harness runs many queries (Grammy, risk, imports, integrity checks)
    expect(session.run.mock.calls.length).toBeGreaterThan(3);
  });

  it('(B3) assert() helper logs ✅ for passing invariants', async () => {
    setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    // With dupes=0 and noPath.cnt=0, at least some invariants pass
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/✅/u);
  });

  it('(B3) assert() helper logs ❌ for failing invariants', async () => {
    setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    // With cnt=0 for all threshold checks, at least some assertions fail
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/❌/u);
  });

  it('(B4) reports summary line with passed/failed counts', async () => {
    setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toMatch(/passed.*failed|Results:/i);
  });

  it('(B5) exits with code 1 when at least one assertion fails', async () => {
    setupIntegritySession();
    // Default session returns cnt=0 → threshold-based assertions fail → failed > 0
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('(B6/FIND-05-02) driver.close() is called after all queries complete', async () => {
    // FIND-05-02 note: implementation calls driver.close() at end of main(),
    // not in a finally block — but it IS called on the normal execution path.
    const session = setupIntegritySession();
    process.argv = ['node', 'test-graph-integrity.js'];
    await import('../test-graph-integrity.js');
    await flushAsync();
    expect(mockDriverClose).toHaveBeenCalled();
  });
});
