/**
 * Structural Drift Guards — C1 Lane
 *
 * Detects when the actual graph structure drifts from expected schema.
 * Runs validation queries that catch data-level issues constraints can't prevent.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Structural Drift
 */

import type { QueryResult } from 'neo4j-driver';

// ============================================================================
// TYPES
// ============================================================================

export interface DriftCheck {
  name: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  passed: boolean;
  violations: number;
  details?: string;
}

export interface DriftReport {
  checks: DriftCheck[];
  passed: number;
  failed: number;
  ok: boolean;
  projectId: string;
  checkedAt: string;
}

// ============================================================================
// DRIFT CHECKS
// ============================================================================

/**
 * Run all structural drift checks for a project.
 */
export async function checkStructuralDrift(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>,
  projectId: string
): Promise<DriftReport> {
  const checks: DriftCheck[] = [];

  // 1. Dangling CALLS edges (caller or callee deleted but edge remains)
  checks.push(await runCheck(run, {
    name: 'dangling_calls',
    description: 'CALLS edges where source or target no longer exists',
    severity: 'critical',
    cypher: `
      MATCH (a {projectId: $projectId})-[r:CALLS]->(b)
      WHERE NOT (a:Function OR a:Method) OR NOT (b:Function OR b:Method)
      RETURN count(r) AS violations
    `,
    projectId,
  }));

  // 2. CONTAINS edges pointing to wrong file
  checks.push(await runCheck(run, {
    name: 'contains_file_mismatch',
    description: 'Function/Method contained by file but filePath differs',
    severity: 'warning',
    cypher: `
      MATCH (sf:SourceFile {projectId: $projectId})-[:CONTAINS]->(f)
      WHERE f.filePath IS NOT NULL AND sf.filePath IS NOT NULL AND f.filePath <> sf.filePath
      RETURN count(f) AS violations
    `,
    projectId,
  }));

  // 3. Risk tier inconsistency
  checks.push(await runCheck(run, {
    name: 'risk_tier_inconsistency',
    description: 'Functions where riskTier doesn\'t match riskLevel range',
    severity: 'warning',
    cypher: `
      MATCH (f:Function {projectId: $projectId})
      WHERE f.riskLevel IS NOT NULL AND f.riskTier IS NOT NULL
        AND NOT (
          (f.riskTier = 'LOW' AND f.riskLevel < 10) OR
          (f.riskTier = 'MEDIUM' AND f.riskLevel >= 10 AND f.riskLevel < 100) OR
          (f.riskTier = 'HIGH' AND f.riskLevel >= 100 AND f.riskLevel < 500) OR
          (f.riskTier = 'CRITICAL' AND f.riskLevel >= 500)
        )
      RETURN count(f) AS violations
    `,
    projectId,
  }));

  // 4. Circular dependencies in tasks
  checks.push(await runCheck(run, {
    name: 'circular_task_deps',
    description: 'Tasks with circular DEPENDS_ON chains',
    severity: 'critical',
    cypher: `
      MATCH path = (t:Task {projectId: $projectId})-[:DEPENDS_ON*2..5]->(t)
      RETURN count(DISTINCT t) AS violations
    `,
    projectId,
  }));

  // 5. Done tasks with hasCodeEvidence=true but no actual HAS_CODE_EVIDENCE edge
  checks.push(await runCheck(run, {
    name: 'phantom_evidence',
    description: 'Tasks claiming evidence (flag=true) but missing actual evidence edge',
    severity: 'warning',
    cypher: `
      MATCH (t:Task {projectId: $projectId, hasCodeEvidence: true})
      WHERE NOT (t)-[:HAS_CODE_EVIDENCE]->()
      RETURN count(t) AS violations
    `,
    projectId,
  }));

  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;

  return {
    checks,
    passed,
    failed,
    ok: checks.filter(c => c.severity === 'critical' && !c.passed).length === 0,
    projectId,
    checkedAt: new Date().toISOString(),
  };
}

// ============================================================================
// INTERNALS
// ============================================================================

async function runCheck(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>,
  opts: {
    name: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    cypher: string;
    projectId: string;
  }
): Promise<DriftCheck> {
  try {
    const result = await run(opts.cypher, { projectId: opts.projectId });
    const violations = result.records[0]?.get('violations')?.toNumber?.() ??
                       result.records[0]?.get('violations') ?? 0;
    return {
      name: opts.name,
      description: opts.description,
      severity: opts.severity,
      passed: violations === 0,
      violations: typeof violations === 'number' ? violations : 0,
    };
  } catch (e) {
    return {
      name: opts.name,
      description: opts.description,
      severity: opts.severity,
      passed: false,
      violations: -1,
      details: (e as Error).message,
    };
  }
}
