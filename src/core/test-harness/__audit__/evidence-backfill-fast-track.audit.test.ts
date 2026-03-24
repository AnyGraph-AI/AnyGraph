/**
 * AUD-TC-03-L1b-32: evidence-backfill-fast-track.ts
 * Role: B6 (Health Witness)
 *
 * Spec: plans/codegraph/GAP_CLOSURE.md — evidence backfill
 * Source: src/utils/evidence-backfill-fast-track.ts (602 LOC)
 *
 * 6 behaviors tested:
 *   B1: supports --dry-run and --report-only modes
 *   B2: queries critical shortlist of done tasks by governance impact
 *   B3: backfills HAS_CODE_EVIDENCE links for high-impact tasks
 *   B4: adds claim guardrail blocking verified claims for plan_only tasks
 *   B5: reports coverage metrics before/after
 *   B6: uses direct neo4j-driver (not Neo4jService)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers: read source for static analysis tests
// ---------------------------------------------------------------------------
const SOURCE_PATH = path.resolve(
  __dirname,
  '../../../utils/evidence-backfill-fast-track.ts'
);
const sourceCode = fs.readFileSync(SOURCE_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// Mock infrastructure for neo4j-driver
// ---------------------------------------------------------------------------

/** Builds a mock Neo4j record that responds to .get() */
function mockRecord(fields: Record<string, unknown>) {
  return {
    get(key: string) {
      return fields[key];
    },
    keys: Object.keys(fields),
  };
}

/** Wraps a raw number into a Neo4j Integer-like object with .low */
function neo4jInt(n: number) {
  return { low: n, high: 0, toNumber: () => n };
}

/** Creates a mock session whose .run() resolves based on query snippets */
function createMockSession(queryResponses: Array<{ match: string | RegExp; records: ReturnType<typeof mockRecord>[] }>) {
  const runFn = vi.fn(async (query: string, _params?: Record<string, unknown>) => {
    for (const qr of queryResponses) {
      const matched = typeof qr.match === 'string'
        ? query.includes(qr.match)
        : qr.match.test(query);
      if (matched) {
        return { records: qr.records };
      }
    }
    return { records: [] };
  });

  return {
    run: runFn,
    close: vi.fn(async () => {}),
  };
}

// ============================================================================
// B6: Uses direct neo4j-driver (not Neo4jService)
// ============================================================================
describe('B6: uses direct neo4j-driver (not Neo4jService)', () => {
  it('imports neo4j-driver directly', () => {
    expect(sourceCode).toMatch(/import\s+.*from\s+['"]neo4j-driver['"]/);
  });

  it('does NOT import Neo4jService', () => {
    expect(sourceCode).not.toMatch(/Neo4jService/);
  });

  it('creates driver via neo4j.driver()', () => {
    expect(sourceCode).toMatch(/neo4j\.driver\(/);
  });

  it('creates sessions via driver.session()', () => {
    expect(sourceCode).toMatch(/driver\.session\(\)/);
  });
});

// ============================================================================
// B1: supports --dry-run and --report-only modes
// ============================================================================
describe('B1: supports --dry-run and --report-only modes', () => {
  it('reads --dry-run from process.argv', () => {
    expect(sourceCode).toContain("process.argv.includes('--dry-run')");
  });

  it('reads --report-only from process.argv', () => {
    expect(sourceCode).toContain("process.argv.includes('--report-only')");
  });

  it('assigns DRY_RUN and REPORT_ONLY as module-level constants', () => {
    expect(sourceCode).toMatch(/const\s+DRY_RUN\s*=/);
    expect(sourceCode).toMatch(/const\s+REPORT_ONLY\s*=/);
  });

  it('dry-run guards the MERGE write path — no MERGE when DRY_RUN', () => {
    // The backfillEvidence function checks `!DRY_RUN && !REPORT_ONLY` before MERGE
    expect(sourceCode).toMatch(/if\s*\(\s*!DRY_RUN\s*&&\s*!REPORT_ONLY\s*\)/);
  });

  it('report-only mode skips the entire backfill block', () => {
    // main() has `if (!REPORT_ONLY)` around the backfill + guardrail + regression sections
    expect(sourceCode).toMatch(/if\s*\(\s*!REPORT_ONLY\s*\)/);
  });

  it('dry-run still counts what WOULD be linked (linked++ in dry branch)', () => {
    // In the else branch (dry-run), linked++ is still executed
    const dryRunBlock = sourceCode.match(/\[dry-run\].*?\n.*?linked\+\+/s);
    expect(dryRunBlock).not.toBeNull();
  });
});

// ============================================================================
// B2: queries critical shortlist of done tasks by governance impact
// ============================================================================
describe('B2: queries critical shortlist of done tasks by governance impact', () => {
  it('defines EVIDENCE_MAPPINGS array with EvidenceMapping interface', () => {
    expect(sourceCode).toMatch(/interface\s+EvidenceMapping/);
    expect(sourceCode).toMatch(/const\s+EVIDENCE_MAPPINGS\s*:\s*EvidenceMapping\[\]/);
  });

  it('each mapping has taskName, category, rank, rationale, sourceFiles', () => {
    expect(sourceCode).toContain('taskName:');
    expect(sourceCode).toContain('category:');
    expect(sourceCode).toContain('rank:');
    expect(sourceCode).toContain('rationale:');
    expect(sourceCode).toContain('sourceFiles:');
  });

  it('queries tasks from plan_codegraph with status=done', () => {
    // Task lookup query filters on planProjectId and status: 'done'
    expect(sourceCode).toMatch(/MATCH\s*\(t:Task\s*\{projectId:\s*\$planProjectId,\s*status:\s*'done'\}/);
  });

  it('categories cover governance-critical areas', () => {
    const requiredCategories = ['gate_policy', 'resolver_status', 'evidence_provenance', 'runtime_capture', 'structural', 'config_schema', 'test_harness'];
    for (const cat of requiredCategories) {
      expect(sourceCode).toContain(`'${cat}'`);
    }
  });

  it('ranks tasks numerically (1-25 governance impact order)', () => {
    // Verify rank: 1 through rank: 25 appear
    expect(sourceCode).toMatch(/rank:\s*1\b/);
    expect(sourceCode).toMatch(/rank:\s*25\b/);
  });

  // SPEC-GAP: GAP_CLOSURE.md spec says "top 25 by governance impact" but does not
  // define the exact ranking algorithm. The implementation uses a hand-curated rank field.
  // There is no automated governance-impact scoring function.
});

// ============================================================================
// B3: backfills HAS_CODE_EVIDENCE links for high-impact tasks
// ============================================================================
describe('B3: backfills HAS_CODE_EVIDENCE links for high-impact tasks', () => {
  it('creates HAS_CODE_EVIDENCE edges via MERGE', () => {
    expect(sourceCode).toMatch(/MERGE\s*\(t\)-\[r:HAS_CODE_EVIDENCE\]->\(sf\)/);
  });

  it('sets edge properties: source, refType, category, rank, rationale, backfilledAt, confidence, projectId', () => {
    expect(sourceCode).toContain("r.source = 'evidence_backfill_fast_track'");
    expect(sourceCode).toContain("r.refType = 'file_path'");
    expect(sourceCode).toContain('r.category = $category');
    expect(sourceCode).toContain('r.rank = $rank');
    expect(sourceCode).toContain('r.rationale = $rationale');
    expect(sourceCode).toContain('r.backfilledAt = datetime()');
    expect(sourceCode).toContain('r.confidence = 1.0');
    expect(sourceCode).toContain('r.projectId = $planProjectId');
  });

  it('skips tasks that already have evidence (dedup check)', () => {
    // Queries existing HAS_CODE_EVIDENCE count before linking
    expect(sourceCode).toMatch(/HAS_CODE_EVIDENCE.*count\(sf\)\s+AS\s+cnt/s);
  });

  it('verifies SourceFile exists in code project before linking', () => {
    expect(sourceCode).toMatch(/MATCH\s*\(sf:SourceFile\s*\{projectId:\s*\$codeProjectId\}/);
  });

  it('tracks not-found tasks and source files', () => {
    expect(sourceCode).toContain('notFound.push(mapping.taskName)');
    expect(sourceCode).toContain('notFound.push(`${mapping.taskName}');
  });

  it('closes session in finally block (resource safety)', () => {
    // backfillEvidence uses try/finally with session.close()
    // Extract from function start to its closing brace (function contains nested braces)
    const fnStart = sourceCode.indexOf('async function backfillEvidence');
    const fnBody = sourceCode.slice(fnStart, fnStart + 5000);
    expect(fnBody).toContain('finally');
    expect(fnBody).toContain('session.close()');
  });
});

// ============================================================================
// B4: adds claim guardrail blocking verified claims for plan_only tasks
// ============================================================================
describe('B4: adds claim guardrail blocking verified claims for plan_only tasks', () => {
  it('defines checkClaimGuardrail function', () => {
    expect(sourceCode).toMatch(/async function checkClaimGuardrail/);
  });

  it('queries tasks with hasCodeEvidence=true but no actual HAS_CODE_EVIDENCE edges', () => {
    // Detects false_evidence_flag: task says it has evidence but no edge exists
    expect(sourceCode).toMatch(/NOT\s*\(t\)-\[:HAS_CODE_EVIDENCE\]->\(\)/);
    expect(sourceCode).toContain('t.hasCodeEvidence = true');
  });

  it('returns violations array with taskName and claimType', () => {
    expect(sourceCode).toContain("r.get('taskName')");
    expect(sourceCode).toContain("r.get('claimType')");
  });

  it('returns ok=true only when zero violations', () => {
    expect(sourceCode).toContain('ok: violations.length === 0');
  });

  it('limits violation output to 50 records', () => {
    expect(sourceCode).toMatch(/LIMIT\s+50/);
  });

  // SPEC-GAP: Spec says "block verified claims for plan_only tasks" but implementation
  // only detects false_evidence_flag (hasCodeEvidence=true without edges). It does not
  // block anything — it reports violations. No enforcement mechanism exists.
});

// ============================================================================
// B5: reports coverage metrics before/after
// ============================================================================
describe('B5: reports coverage metrics before/after', () => {
  it('defines CoverageMetrics interface with required fields', () => {
    expect(sourceCode).toMatch(/interface\s+CoverageMetrics/);
    expect(sourceCode).toContain('totalDone: number');
    expect(sourceCode).toContain('doneWithEvidence: number');
    expect(sourceCode).toContain('doneWithoutEvidence: number');
    expect(sourceCode).toContain('doneWithEvidencePct: number');
    expect(sourceCode).toContain('topUnverifiedDoneTasks: string[]');
    expect(sourceCode).toContain('byCategory:');
  });

  it('getCoverageMetrics computes before AND after in main()', () => {
    // main() calls getCoverageMetrics twice: once for "before", once for "after"
    const mainFn = sourceCode.slice(sourceCode.indexOf('async function main'));
    const beforeMatch = mainFn.match(/const\s+before\s*=\s*await\s+getCoverageMetrics/);
    const afterMatch = mainFn.match(/const\s+after\s*=\s*await\s+getCoverageMetrics/);
    expect(beforeMatch).not.toBeNull();
    expect(afterMatch).not.toBeNull();
  });

  it('computes percentage correctly (with zero-division guard)', () => {
    expect(sourceCode).toContain('totalDone > 0 ? Math.round((withEvidence / totalDone) * 1000) / 10 : 0');
  });

  it('queries top unverified done tasks ordered by milestone', () => {
    expect(sourceCode).toMatch(/WHERE NOT \(t\)-\[:HAS_CODE_EVIDENCE\]->\(\)/);
    expect(sourceCode).toMatch(/OPTIONAL MATCH \(t\)-\[:PART_OF\]->\(m:Milestone\)/);
    expect(sourceCode).toContain('ORDER BY milestone, task');
    expect(sourceCode).toContain('LIMIT 20');
  });

  it('computes coverage delta in main output', () => {
    expect(sourceCode).toContain('after.doneWithEvidence - before.doneWithEvidence');
    expect(sourceCode).toContain('before.doneWithEvidencePct');
    expect(sourceCode).toContain('after.doneWithEvidencePct');
  });

  it('includes regression check comparing against IntegritySnapshot', () => {
    expect(sourceCode).toMatch(/async function checkCoverageRegression/);
    expect(sourceCode).toContain('s.evidenceCoveragePct');
    expect(sourceCode).toContain('currentPct < previousPct');
  });

  it('reports final summary as JSON', () => {
    expect(sourceCode).toContain('JSON.stringify');
    expect(sourceCode).toContain('ok: true');
    expect(sourceCode).toContain('totalDone: final.totalDone');
  });

  it('closes driver at the end of main()', () => {
    expect(sourceCode).toContain('await driver.close()');
  });
});

// ============================================================================
// Additional integration-style tests: mode behavior via mock session
// ============================================================================
describe('Integration: backfillEvidence behavior with mocked neo4j session', () => {
  // We can't import the module directly (it connects to real neo4j at import time
  // and calls main()). Instead we test the behavioral contracts via source analysis
  // and structural assertions that validate the flow.

  // SPEC-GAP: The module executes main() at module level (no guard for
  // `if (require.main === module)` or similar), making it impossible to
  // import individual functions for unit testing without side effects.
  // This forces static analysis testing rather than runtime mocking.

  it('backfillEvidence iterates over all EVIDENCE_MAPPINGS entries', () => {
    expect(sourceCode).toContain('for (const mapping of EVIDENCE_MAPPINGS)');
  });

  it('backfillEvidence returns { linked, skipped, notFound, linked_tasks }', () => {
    expect(sourceCode).toMatch(/return\s*\{\s*linked,\s*skipped,\s*notFound,\s*linked_tasks\s*\}/);
  });

  it('main() exits with code 1 on error', () => {
    expect(sourceCode).toContain('process.exit(1)');
  });

  it('PLAN_PROJECT_ID targets plan_codegraph', () => {
    expect(sourceCode).toContain("const PLAN_PROJECT_ID = 'plan_codegraph'");
  });

  it('CODE_PROJECT_ID targets proj_c0d3e9a1f200', () => {
    expect(sourceCode).toContain("const CODE_PROJECT_ID = 'proj_c0d3e9a1f200'");
  });
});

// ============================================================================
// Structural completeness checks
// ============================================================================
describe('Structural completeness', () => {
  it('defines all governance categories used in mappings', () => {
    // Type union declares 7 categories but 'structural' is unused in actual mappings.
    // SPEC-GAP: 'structural' category declared in type but no mapping uses it.
    const categoryUnion = sourceCode.match(/category:\s*'([^']+)'/g);
    const categories = new Set(categoryUnion?.map(c => c.match(/'([^']+)'/)?.[1]));
    // 6 categories actually used: gate_policy, resolver_status, evidence_provenance,
    // runtime_capture, config_schema, test_harness
    expect(categories.size).toBeGreaterThanOrEqual(6);
  });

  it('has 25 evidence mappings covering ranks 1-25', () => {
    const rankMatches = sourceCode.match(/rank:\s*(\d+)/g);
    const ranks = rankMatches?.map(r => parseInt(r.match(/\d+/)![0]));
    expect(ranks).toBeDefined();
    expect(ranks!.length).toBe(25);
    expect(Math.min(...ranks!)).toBe(1);
    expect(Math.max(...ranks!)).toBe(25);
  });

  it('session.close() called in finally for every session creation', () => {
    // Count session creations vs finally+close patterns
    const sessionCreations = (sourceCode.match(/driver\.session\(\)/g) || []).length;
    const finallyCloses = (sourceCode.match(/finally\s*\{[^}]*session\.close\(\)/gs) || []).length;
    // At minimum, backfillEvidence, checkClaimGuardrail, getCoverageMetrics, checkCoverageRegression
    expect(sessionCreations).toBeGreaterThanOrEqual(4);
    expect(finallyCloses).toBeGreaterThanOrEqual(4);
  });

  // SPEC-GAP: No CLI --help output. Usage comment at top but no programmatic help handler.
  // SPEC-GAP: No logging/audit trail of backfill operations beyond console output.
  // SPEC-GAP: Completion taxonomy (done_documented vs done_verified) is described in
  // comments but never materialized as queryable labels or properties.
});
