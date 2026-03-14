/**
 * Test Provenance Schema — SLSA-shaped Governance Contract
 *
 * Captures provenance for test and runtime artifacts.
 * Every governed test run must produce a provenance record.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N1, S5 Provenance Store
 */

export const TEST_PROVENANCE_SCHEMA_VERSION = '1.0.0' as const;

// ============================================================================
// PROVENANCE RECORD
// ============================================================================

/**
 * SLSA-shaped provenance for test/baseline artifacts and runtime artifacts.
 */
export interface TestProvenanceRecord {
  /** Digest(s) of the subject artifact(s) */
  subjectDigests: SubjectDigest[];
  /** External parameters that affect the test outcome */
  externalParameters: ExternalParameters;
  /** Resolved dependency snapshot */
  resolvedDependencies: ResolvedDependency[];
  /** Identity of the builder/runner */
  builderId: string;
  /** Unique invocation identifier */
  invocationId: string;
  /** ISO timestamp of execution */
  executedAt: string;
  /** Byproducts (logs, counterexamples, diffs) */
  byproducts: Byproduct[];
}

export interface SubjectDigest {
  /** Artifact name or path */
  name: string;
  /** Content digest (sha256:...) */
  digest: string;
  /** MIME type or artifact type */
  type: string;
}

export interface ExternalParameters {
  /** Test lane that produced this artifact */
  lane: string;
  /** Fixture tier used */
  fixtureTier: 'micro' | 'scenario' | 'sampled' | 'stress';
  /** RNG seed (for reproducibility) */
  seed?: string;
  /** Frozen clock value (ISO timestamp) */
  frozenClock?: string;
  /** Any additional parameters */
  [key: string]: unknown;
}

export interface ResolvedDependency {
  /** Dependency name */
  name: string;
  /** Dependency version or digest */
  version: string;
}

export interface Byproduct {
  /** Byproduct type */
  type: 'log' | 'counterexample' | 'diff' | 'snapshot' | 'report';
  /** Path or reference */
  ref: string;
  /** Content digest */
  digest?: string;
}

// ============================================================================
// REQUIRED FIELDS CONTRACT
// ============================================================================

/**
 * Required fields that must be present on every provenance record.
 * Missing required provenance → fail-closed on required surfaces.
 */
export const REQUIRED_PROVENANCE_FIELDS: (keyof TestProvenanceRecord)[] = [
  'subjectDigests',
  'externalParameters',
  'builderId',
  'invocationId',
  'executedAt',
] as const;
