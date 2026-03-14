/**
 * Gate Decision Packet Schema — Governance Contract
 *
 * Defines the required fields for every governance gate decision.
 * Decisions must be replayable from immutable inputs.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N1, Lane D
 */

export const GATE_DECISION_PACKET_SCHEMA_VERSION = '1.0.0' as const;

// ============================================================================
// GATE MODE
// ============================================================================

export enum GateMode {
  /** Log only, never block */
  ADVISORY = 'advisory',
  /** Block with human override available */
  ASSISTED = 'assisted',
  /** Fail-closed, no override */
  ENFORCED = 'enforced',
}

// ============================================================================
// GATE DECISION PACKET
// ============================================================================

/**
 * Every gate execution produces a GateDecisionPacket.
 * This packet contains everything needed to replay the decision deterministically.
 */
export interface GateDecisionPacket {
  /** Digest of the policy bundle used for this decision */
  policyBundleDigest: string;
  /** Digest of the contract bundle (query contracts, schema contracts) */
  contractBundleDigest: string;
  /** Digest of the graph snapshot at decision time */
  graphSnapshotDigest: string;
  /** Digest of the input snapshot (changed files, commit info) */
  inputSnapshotDigest: string;
  /** Reference to the full decision log */
  decisionLogRef: string;
  /** Gate mode at execution time */
  mode: GateMode;
  /** Expected decision (test artifact — only present in test runs) */
  expectedDecision?: GateDecision;
  /** Provenance reference (links to verification run) */
  provenanceRef: string;
  /** Identity of the builder/runner that executed the gate */
  builderId: string;
  /** Unique invocation identifier */
  invocationId: string;
  /** ISO timestamp of decision */
  decidedAt: string;
  /** The actual decision */
  decision: GateDecision;
  /** Replay hash: deterministic hash of (policyBundle + contractBundle + graphSnapshot + inputSnapshot) */
  replayHash: string;
}

export enum GateDecision {
  PASS = 'pass',
  FAIL = 'fail',
  ADVISORY_WARN = 'advisory_warn',
}

// ============================================================================
// REPLAY CONTRACT
// ============================================================================

/**
 * Replay invariant: given the same (policyBundleDigest, contractBundleDigest,
 * graphSnapshotDigest, inputSnapshotDigest), the decision MUST be identical.
 *
 * replayMismatchCount target: 0
 */
export interface ReplayContract {
  version: string;
  invariant: string;
  target: number;
}

export const REPLAY_CONTRACT: ReplayContract = {
  version: GATE_DECISION_PACKET_SCHEMA_VERSION,
  invariant: 'Same inputs produce same decision (deterministic gate)',
  target: 0,
} as const;
