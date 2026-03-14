/**
 * Change-Class Lane Matrix — Governance Schema
 *
 * Defines which test lanes are required for each class of change.
 * This is the frozen contract: no governed test without schema compliance.
 *
 * Schema version is immutable once published. New versions require
 * a new schema object with a bumped version string.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N1, Decision: Change-Class Lane Matrix
 */

// ============================================================================
// LANE DEFINITIONS
// ============================================================================

/**
 * Test lane identifiers.
 * Each lane covers a distinct correctness surface.
 */
export enum TestLane {
  /** Lane A — Code TDD: parser logic, resolvers, materializers, utility transforms */
  A_CODE = 'A',
  /** Lane B — Contract TDD: query contracts, artifact schemas, backward-compatibility */
  B_CONTRACT = 'B',
  /** Lane C1 — Structural Integrity: DB constraints, migration checks, structural drift */
  C1_STRUCTURAL = 'C1',
  /** Lane C2 — Semantic Governance: done-without-evidence, scope gaps, waiver expiry */
  C2_SEMANTIC = 'C2',
  /** Lane C3 — Confidence Propagation: support/contradiction/freshness correctness */
  C3_CONFIDENCE = 'C3',
  /** Lane D — Gate/Policy TDD: advisory/assisted/enforced semantics, replay determinism */
  D_GATE_POLICY = 'D',
  /** Lane E — AI Eval TDD (TEVV): prompt/model/skill/tool/retrieval/evaluator changes */
  E_AI_EVAL = 'E',
}

/**
 * Lane metadata for display and tooling.
 */
export interface LaneDefinition {
  id: TestLane;
  name: string;
  purpose: string;
  coverage: string[];
}

export const LANE_DEFINITIONS: Record<TestLane, LaneDefinition> = {
  [TestLane.A_CODE]: {
    id: TestLane.A_CODE,
    name: 'Code TDD',
    purpose: 'Fast local correctness',
    coverage: ['parser logic', 'resolvers/reducers/materializers', 'utility transforms'],
  },
  [TestLane.B_CONTRACT]: {
    id: TestLane.B_CONTRACT,
    name: 'Contract TDD',
    purpose: 'Keep external/internal interfaces stable',
    coverage: ['query contracts', 'artifact schemas', 'SKILL.md schema contracts', 'backward-compatibility assertions'],
  },
  [TestLane.C1_STRUCTURAL]: {
    id: TestLane.C1_STRUCTURAL,
    name: 'Structural Integrity',
    purpose: 'DB-enforceable correctness',
    coverage: ['uniqueness/existence/type/key constraints', 'migration contract checks', 'structural drift guards'],
  },
  [TestLane.C2_SEMANTIC]: {
    id: TestLane.C2_SEMANTIC,
    name: 'Semantic Governance',
    purpose: 'Governance invariant correctness',
    coverage: ['done-without-evidence fails', 'scope gaps => UNKNOWN_FOR', 'waiver expiry enforcement', 'cross-project contamination prevention'],
  },
  [TestLane.C3_CONFIDENCE]: {
    id: TestLane.C3_CONFIDENCE,
    name: 'Confidence Propagation',
    purpose: 'Deterministic confidence behavior',
    coverage: ['support/contradiction/freshness contributions', 'deterministic downgrade/upgrade', 'no invalid confidence from stale evidence'],
  },
  [TestLane.D_GATE_POLICY]: {
    id: TestLane.D_GATE_POLICY,
    name: 'Gate/Policy TDD',
    purpose: 'Deterministic governance outcomes',
    coverage: ['advisory/assisted/enforced semantics', 'override/waiver behavior', 'audit trail correctness', 'replay determinism'],
  },
  [TestLane.E_AI_EVAL]: {
    id: TestLane.E_AI_EVAL,
    name: 'AI Eval TDD (TEVV)',
    purpose: 'AI changes require category-level evidence',
    coverage: ['prompt changes', 'skill changes', 'model version changes', 'tool wiring changes', 'retrieval/ranking changes', 'evaluator logic changes'],
  },
} as const;

// ============================================================================
// CHANGE CLASS DEFINITIONS
// ============================================================================

/**
 * Change class identifiers.
 * Each change to the codebase falls into exactly one class,
 * which determines which test lanes must pass before merge.
 */
export enum ChangeClass {
  /** Pure code logic changes (no schema, no governance, no AI) */
  CODE_ONLY = 'code_only',
  /** Changes to queries, schemas, or artifact formats */
  QUERY_SCHEMA_ARTIFACT = 'query_schema_artifact',
  /** Changes to status resolution, invariant logic, or confidence computation */
  STATUS_INVARIANT_CONFIDENCE = 'status_invariant_confidence',
  /** Changes to gate logic or policy bundles */
  GATE_POLICY = 'gate_policy',
  /** Changes to prompts, models, skills, tools, retrieval, ranking, or evaluators */
  AI_EVAL = 'ai_eval',
}

export interface ChangeClassDefinition {
  id: ChangeClass;
  name: string;
  description: string;
  /** File path patterns that trigger this change class */
  triggerPatterns: string[];
  /** Required lanes that MUST pass for this change class */
  requiredLanes: TestLane[];
  /** Conditional lanes (required only when governance output is affected) */
  conditionalLanes?: { lane: TestLane; condition: string }[];
}

// ============================================================================
// FROZEN MATRIX (v1)
// ============================================================================

export const CHANGE_CLASS_MATRIX_VERSION = '1.0.0' as const;

export const CHANGE_CLASS_MATRIX: Record<ChangeClass, ChangeClassDefinition> = {
  [ChangeClass.CODE_ONLY]: {
    id: ChangeClass.CODE_ONLY,
    name: 'Code-only logic',
    description: 'Pure code logic changes: parser, resolver, materializer, utility',
    triggerPatterns: [
      'src/core/parsers/**',
      'src/core/ir/**',
      'src/core/utils/**',
      'src/utils/**',
      'src/storage/**',
    ],
    requiredLanes: [TestLane.A_CODE],
  },

  [ChangeClass.QUERY_SCHEMA_ARTIFACT]: {
    id: ChangeClass.QUERY_SCHEMA_ARTIFACT,
    name: 'Query/schema/artifact change',
    description: 'Changes to query contracts, graph schemas, or artifact formats',
    triggerPatterns: [
      'src/core/config/schema.ts',
      'src/core/config/query-contract*.ts',
      'src/core/ir/ir-v1.schema.ts',
      'artifacts/**/*.json',
      'src/mcp/tools/**',
    ],
    requiredLanes: [TestLane.A_CODE, TestLane.B_CONTRACT, TestLane.C1_STRUCTURAL],
  },

  [ChangeClass.STATUS_INVARIANT_CONFIDENCE]: {
    id: ChangeClass.STATUS_INVARIANT_CONFIDENCE,
    name: 'Status/invariant/confidence logic',
    description: 'Changes to status resolution, governance invariants, or confidence computation',
    triggerPatterns: [
      'src/scripts/verify/**',
      'src/utils/verify-*',
      'src/utils/hygiene-*',
      'src/core/claims/**',
      'src/utils/verification-*',
    ],
    requiredLanes: [
      TestLane.A_CODE,
      TestLane.B_CONTRACT,
      TestLane.C1_STRUCTURAL,
      TestLane.C2_SEMANTIC,
      TestLane.C3_CONFIDENCE,
    ],
  },

  [ChangeClass.GATE_POLICY]: {
    id: ChangeClass.GATE_POLICY,
    name: 'Gate/policy bundle change',
    description: 'Changes to gate logic, policy bundles, or governance decision flows',
    triggerPatterns: [
      'src/utils/plan-refresh-for-gates.ts',
      'src/utils/verification-done-check-capture.ts',
      'config/hygiene-exceptions*.json',
      'docs/GOVERNANCE_STRICT_ROLLOUT.md',
    ],
    requiredLanes: [TestLane.A_CODE, TestLane.B_CONTRACT, TestLane.D_GATE_POLICY],
  },

  [ChangeClass.AI_EVAL]: {
    id: ChangeClass.AI_EVAL,
    name: 'AI eval (prompt/model/skill/tool/retrieval/evaluator)',
    description: 'Changes to AI-facing surfaces that require TEVV evidence',
    triggerPatterns: [
      'src/core/embeddings/**',
      'src/mcp/handlers/nl-to-cypher*',
      'SKILL.md',
      'AGENTS.md',
      'CLAUDE.md',
      '.mcp.json',
    ],
    requiredLanes: [TestLane.A_CODE, TestLane.B_CONTRACT, TestLane.E_AI_EVAL],
    conditionalLanes: [
      { lane: TestLane.D_GATE_POLICY, condition: 'when governance output is affected' },
    ],
  },
} as const;

// ============================================================================
// MERGE RULE
// ============================================================================

/**
 * Merge rule: required lanes for the declared change class MUST pass.
 * Retries do not convert critical failure into pass.
 */
export interface MergeRule {
  version: string;
  rule: string;
  enforcement: 'fail-closed';
  retryPolicy: 'no-critical-to-pass';
}

export const MERGE_RULE: MergeRule = {
  version: CHANGE_CLASS_MATRIX_VERSION,
  rule: 'Required lanes for declared change class must pass before merge',
  enforcement: 'fail-closed',
  retryPolicy: 'no-critical-to-pass',
} as const;

// ============================================================================
// CLASSIFICATION HELPER
// ============================================================================

/**
 * Given a list of changed file paths, determine the change class.
 * Returns the most restrictive class that matches any changed file.
 *
 * Priority order (most restrictive first):
 *   STATUS_INVARIANT_CONFIDENCE > GATE_POLICY > AI_EVAL > QUERY_SCHEMA_ARTIFACT > CODE_ONLY
 */
export function classifyChange(changedFiles: string[]): ChangeClass {
  const priority: ChangeClass[] = [
    ChangeClass.STATUS_INVARIANT_CONFIDENCE,
    ChangeClass.GATE_POLICY,
    ChangeClass.AI_EVAL,
    ChangeClass.QUERY_SCHEMA_ARTIFACT,
    ChangeClass.CODE_ONLY,
  ];

  for (const cls of priority) {
    const def = CHANGE_CLASS_MATRIX[cls];
    for (const file of changedFiles) {
      for (const pattern of def.triggerPatterns) {
        if (matchGlob(file, pattern)) {
          return cls;
        }
      }
    }
  }

  // Default: code-only (safest default for unknown files)
  return ChangeClass.CODE_ONLY;
}

/**
 * Get required lanes for a change class.
 */
export function getRequiredLanes(changeClass: ChangeClass): TestLane[] {
  return [...CHANGE_CLASS_MATRIX[changeClass].requiredLanes];
}

/**
 * Simple glob matching (supports ** and * patterns).
 */
function matchGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DOUBLESTAR\}\}/g, '.*')
    .replace(/\//g, '\\/');
  return new RegExp(`^${regex}$`).test(filePath);
}
