/**
 * Structural Integrity Constraints — C1 Lane
 *
 * DB-enforceable uniqueness, existence, type, and key constraints.
 * These are the structural invariants that Neo4j itself can enforce.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, C1 Constraints
 */

import type { QueryResult } from 'neo4j-driver';

// ============================================================================
// TYPES
// ============================================================================

export interface ConstraintDefinition {
  /** Human-readable name */
  name: string;
  /** Cypher CREATE CONSTRAINT statement */
  cypher: string;
  /** What this constraint prevents */
  rationale: string;
  /** Whether this is critical (blocks test) or advisory */
  severity: 'critical' | 'advisory';
}

export interface ConstraintCheckResult {
  /** Constraint name */
  name: string;
  /** Whether the constraint exists in the database */
  exists: boolean;
  /** Whether a validation query passed (if applicable) */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
}

export interface StructuralIntegrityReport {
  /** All constraint check results */
  checks: ConstraintCheckResult[];
  /** Number of passing checks */
  passed: number;
  /** Number of failing checks */
  failed: number;
  /** Overall pass/fail */
  ok: boolean;
  /** Timestamp */
  checkedAt: string;
}

// ============================================================================
// CONSTRAINT DEFINITIONS
// ============================================================================

/**
 * Core structural constraints for the AnythingGraph schema.
 * These are the C1 (structural integrity) lane requirements.
 */
export const CORE_CONSTRAINTS: ConstraintDefinition[] = [
  // Uniqueness constraints
  {
    name: 'unique_sourcefile',
    cypher: 'CREATE CONSTRAINT unique_sourcefile IF NOT EXISTS FOR (n:SourceFile) REQUIRE (n.projectId, n.filePath) IS UNIQUE',
    rationale: 'No duplicate files within a project',
    severity: 'critical',
  },
  {
    name: 'unique_function',
    cypher: 'CREATE CONSTRAINT unique_function IF NOT EXISTS FOR (n:Function) REQUIRE (n.projectId, n.name, n.filePath) IS UNIQUE',
    rationale: 'No duplicate function declarations within a file/project',
    severity: 'critical',
  },
  {
    name: 'unique_task',
    cypher: 'CREATE CONSTRAINT unique_task IF NOT EXISTS FOR (n:Task) REQUIRE (n.id) IS UNIQUE',
    rationale: 'Task identity is stable ID (project+file+section+ordinal), not task name',
    severity: 'critical',
  },
  {
    name: 'unique_milestone',
    cypher: 'CREATE CONSTRAINT unique_milestone IF NOT EXISTS FOR (n:Milestone) REQUIRE (n.id) IS UNIQUE',
    rationale: 'Milestone identity is stable ID, allowing duplicate names in different contexts',
    severity: 'critical',
  },
  {
    name: 'unique_project',
    cypher: 'CREATE CONSTRAINT unique_project IF NOT EXISTS FOR (n:Project) REQUIRE (n.projectId) IS UNIQUE',
    rationale: 'No duplicate project IDs',
    severity: 'critical',
  },
];

/**
 * Validation queries that check data integrity beyond constraints.
 * These catch violations that constraints alone can't prevent.
 */
export const VALIDATION_QUERIES: Array<{
  name: string;
  description: string;
  cypher: string;
  expectEmpty: boolean;
  severity: 'critical' | 'advisory';
}> = [
  {
    name: 'orphan_functions',
    description: 'Functions not contained by any SourceFile',
    cypher: `
      MATCH (f:Function {projectId: $projectId})
      WHERE NOT ()-[:CONTAINS]->(f)
      RETURN f.name AS name, f.filePath AS filePath
      LIMIT 10
    `,
    expectEmpty: true,
    severity: 'advisory',
  },
  {
    name: 'duplicate_calls_edges',
    description: 'Duplicate CALLS edges between same source and target',
    cypher: `
      MATCH (a {projectId: $projectId})-[r:CALLS]->(b)
      WITH a, b, count(r) AS cnt
      WHERE cnt > 1
      RETURN a.name AS caller, b.name AS callee, cnt
      LIMIT 10
    `,
    expectEmpty: true,
    severity: 'advisory',
  },
  {
    name: 'tasks_without_milestone',
    description: 'Tasks not linked to any Milestone',
    cypher: `
      MATCH (t:Task {projectId: $projectId})
      WHERE NOT (t)-[:PART_OF]->(:Milestone)
      RETURN t.name AS name
      LIMIT 10
    `,
    expectEmpty: true,
    severity: 'advisory',
  },
  {
    name: 'self_referencing_depends',
    description: 'Tasks that depend on themselves',
    cypher: `
      MATCH (t:Task {projectId: $projectId})-[:DEPENDS_ON]->(t)
      RETURN t.name AS name
      LIMIT 10
    `,
    expectEmpty: true,
    severity: 'critical',
  },
  {
    name: 'missing_projectid',
    description: 'Nodes missing projectId (except system nodes) — scoped by label overlap with project nodes',
    cypher: `
      MATCH (n)
      WHERE n.projectId IS NULL
        AND (n:SourceFile OR n:Function OR n:Method OR n:Class OR n:Interface
             OR n:TypeAlias OR n:Variable OR n:Property OR n:Parameter
             OR n:Import OR n:Field OR n:Entrypoint OR n:Task OR n:Milestone
             OR n:Sprint OR n:Decision OR n:Section OR n:PlanProject OR n:TestCase)
      RETURN labels(n)[0] AS label, count(n) AS count
      LIMIT 10
    `,
    expectEmpty: true,
    severity: 'advisory',
  },
];

// ============================================================================
// OPERATIONS
// ============================================================================

/**
 * Apply all core constraints to the database.
 * Idempotent — safe to call multiple times.
 */
export async function applyConstraints(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>
): Promise<{ applied: number; errors: string[] }> {
  let applied = 0;
  const errors: string[] = [];

  for (const constraint of CORE_CONSTRAINTS) {
    try {
      await run(constraint.cypher);
      applied++;
    } catch (e) {
      errors.push(`${constraint.name}: ${(e as Error).message}`);
    }
  }

  return { applied, errors };
}

/**
 * Check all structural integrity constraints and validations.
 */
export async function checkStructuralIntegrity(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>,
  projectId: string
): Promise<StructuralIntegrityReport> {
  const checks: ConstraintCheckResult[] = [];

  // Check constraint existence
  const existingConstraints = await run('SHOW CONSTRAINTS YIELD name RETURN collect(name) AS names');
  const constraintNames = (existingConstraints.records[0]?.get('names') as string[]) ?? [];

  for (const constraint of CORE_CONSTRAINTS) {
    checks.push({
      name: constraint.name,
      exists: constraintNames.includes(constraint.name),
      valid: constraintNames.includes(constraint.name),
      error: constraintNames.includes(constraint.name) ? undefined : 'Constraint does not exist',
    });
  }

  // Run validation queries
  for (const validation of VALIDATION_QUERIES) {
    try {
      const result = await run(validation.cypher, { projectId });
      const isEmpty = result.records.length === 0;
      const valid = validation.expectEmpty ? isEmpty : !isEmpty;
      checks.push({
        name: validation.name,
        exists: true,
        valid,
        error: valid ? undefined : `Found ${result.records.length} violations`,
      });
    } catch (e) {
      checks.push({
        name: validation.name,
        exists: true,
        valid: false,
        error: (e as Error).message,
      });
    }
  }

  const passed = checks.filter(c => c.valid).length;
  const failed = checks.filter(c => !c.valid).length;

  return {
    checks,
    passed,
    failed,
    ok: failed === 0,
    checkedAt: new Date().toISOString(),
  };
}
