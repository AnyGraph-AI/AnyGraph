/**
 * AI Eval Lineage Schema — Governance Contract
 *
 * Required lineage fields for AI-facing changes (Lane E — TEVV).
 * Any change to prompts, models, skills, tools, retrieval, ranking,
 * or evaluators must produce an eval lineage record.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N1, Lane E
 */

export const EVAL_LINEAGE_SCHEMA_VERSION = '1.0.0' as const;

// ============================================================================
// EVAL LINEAGE RECORD
// ============================================================================

export interface EvalLineageRecord {
  /** Version of the eval set used */
  evalSetVersion: string;
  /** Hazard classification for this change */
  hazardClass: HazardClass;
  /** Reference to the baseline this eval is compared against */
  baselineRef: string;
  /** Delta metrics vs baseline */
  deltaMetrics: DeltaMetric[];
  /** Model version at eval time */
  modelVersion: string;
  /** Prompt version (content digest) */
  promptVersion: string;
  /** Digest of the full toolchain configuration */
  toolchainDigest: string;
  /** Version of the evaluator logic */
  evaluatorVersion: string;
  /** Deterministic hash of the promotion decision */
  promotionDecisionHash: string;
  /** ISO timestamp */
  evaluatedAt: string;
}

export enum HazardClass {
  /** No hazard — cosmetic or non-functional change */
  NONE = 'none',
  /** Low hazard — minor behavioral change */
  LOW = 'low',
  /** Medium hazard — significant behavioral change */
  MEDIUM = 'medium',
  /** High hazard — safety-relevant change */
  HIGH = 'high',
  /** Critical hazard — requires adversarial eval set */
  CRITICAL = 'critical',
}

export interface DeltaMetric {
  /** Metric name */
  name: string;
  /** Baseline value */
  baseline: number;
  /** Current value */
  current: number;
  /** Delta (current - baseline) */
  delta: number;
  /** Whether this delta exceeds the per-hazard threshold */
  exceedsThreshold: boolean;
}

// ============================================================================
// ACTIVATION TRIGGERS
// ============================================================================

/**
 * File patterns that trigger Lane E (AI Eval) requirements.
 * Any change matching these patterns requires an EvalLineageRecord.
 */
export const AI_EVAL_TRIGGERS: string[] = [
  'src/core/embeddings/**',
  'src/mcp/handlers/nl-to-cypher*',
  'SKILL.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.mcp.json',
];

// ============================================================================
// REQUIRED FIELDS CONTRACT
// ============================================================================

export const REQUIRED_EVAL_LINEAGE_FIELDS: (keyof EvalLineageRecord)[] = [
  'evalSetVersion',
  'hazardClass',
  'baselineRef',
  'deltaMetrics',
  'modelVersion',
  'promptVersion',
  'toolchainDigest',
  'evaluatorVersion',
  'promotionDecisionHash',
] as const;
