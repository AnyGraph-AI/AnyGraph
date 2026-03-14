/**
 * Gate Evaluator — Deterministic Governance Gate Execution
 *
 * Evaluates governance gates from immutable input snapshots + pinned policy bundles.
 * The same (policy, inputs) MUST produce the same decision — this is the replay invariant.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X1, Tasks 2-3
 */

import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  GateMode,
  GateDecision,
  type GateDecisionPacket,
  GATE_DECISION_PACKET_SCHEMA_VERSION,
} from '../config/gate-decision-packet-schema.js';
import {
  type InvariantDefinition,
  InvariantClass,
  EnforcementMode,
} from '../config/invariant-registry-schema.js';
import { classifyChange, getRequiredLanes, type ChangeClass } from '../config/change-class-matrix.js';
import {
  type PolicyBundle,
  resolveGateMode,
  getApplicableInvariants,
} from './policy-bundle.js';

// ============================================================================
// INPUT SNAPSHOT
// ============================================================================

/**
 * Immutable input snapshot for gate evaluation.
 * Everything the gate needs to make a decision — no ambient reads.
 */
export interface GateInputSnapshot {
  /** SHA of the commit being evaluated */
  commitSha: string;
  /** Changed file paths (relative to repo root) */
  changedFiles: string[];
  /** Project ID for scoping */
  projectId: string;
  /** Invariant check results — each invariant evaluated against current state */
  invariantResults: InvariantCheckResult[];
  /** Graph snapshot digest (from snapshot-digest.ts) */
  graphSnapshotDigest: string;
  /** Lane results (which test lanes passed/failed) */
  laneResults?: LaneResult[];
  /** Digest of this input snapshot (computed, not user-provided) */
  digest: string;
}

export interface InvariantCheckResult {
  /** Which invariant was checked */
  invariantId: string;
  /** Did it pass? */
  passed: boolean;
  /** Violation count (0 if passed) */
  violationCount: number;
  /** Counterexample artifacts (if any) */
  counterexamples: Array<Record<string, unknown>>;
  /** Diagnostic message */
  message: string;
}

export interface LaneResult {
  /** Lane ID (A, B, C1, C2, C3, D, E) */
  laneId: string;
  /** Did all tests in this lane pass? */
  passed: boolean;
  /** Test count */
  testCount: number;
  /** Failure count */
  failureCount: number;
}

// ============================================================================
// INPUT SNAPSHOT CREATION
// ============================================================================

/**
 * Create an immutable input snapshot.
 * Computes the digest from all content fields.
 */
export function createInputSnapshot(opts: {
  commitSha: string;
  changedFiles: string[];
  projectId: string;
  invariantResults: InvariantCheckResult[];
  graphSnapshotDigest: string;
  laneResults?: LaneResult[];
}): GateInputSnapshot {
  const snapshot: GateInputSnapshot = {
    ...opts,
    digest: '',
  };
  snapshot.digest = computeInputDigest(snapshot);
  return Object.freeze(snapshot) as GateInputSnapshot;
}

function computeInputDigest(snapshot: GateInputSnapshot): string {
  const { digest: _, ...content } = snapshot;
  const canonical = JSON.stringify(content, Object.keys(content).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify an input snapshot's digest.
 */
export function verifyInputDigest(snapshot: GateInputSnapshot): boolean {
  return snapshot.digest === computeInputDigest(snapshot);
}

// ============================================================================
// DECISION LOG
// ============================================================================

export interface DecisionLogEntry {
  invariantId: string;
  mode: GateMode;
  passed: boolean;
  violationCount: number;
  action: 'pass' | 'warn' | 'block';
  reason: string;
}

export interface DecisionLog {
  /** Unique log ID */
  logId: string;
  /** When the evaluation ran */
  evaluatedAt: string;
  /** Per-invariant decisions */
  entries: DecisionLogEntry[];
  /** Change class determined from changed files */
  changeClass: ChangeClass;
  /** Required lanes for this change class */
  requiredLanes: string[];
  /** Lane pass/fail summary */
  laneSummary?: LaneResult[];
  /** Overall decision */
  decision: GateDecision;
  /** Decision reasoning */
  reasoning: string;
}

// ============================================================================
// GATE EVALUATOR
// ============================================================================

export interface GateEvaluatorConfig {
  /** Builder identity string */
  builderId: string;
  /** Directory to write decision logs */
  logDir?: string;
  /** Whether to persist decision logs to disk */
  persistLogs?: boolean;
}

/**
 * Evaluate a governance gate from immutable inputs + pinned policy.
 *
 * DETERMINISM INVARIANT: same (policyBundle.digest, inputSnapshot.digest)
 * MUST produce identical (decision, entries). The only varying fields
 * are timestamps and UUIDs.
 */
export function evaluateGate(
  policy: PolicyBundle,
  input: GateInputSnapshot,
  config: GateEvaluatorConfig
): { packet: GateDecisionPacket; log: DecisionLog } {
  const invocationId = `gate_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const logId = `log_${invocationId}`;
  const changeClass = classifyChange(input.changedFiles);
  const requiredLanes = getRequiredLanes(changeClass);
  const applicableInvariants = getApplicableInvariants(policy, changeClass);

  // Evaluate each invariant
  const entries: DecisionLogEntry[] = [];
  for (const invariant of applicableInvariants) {
    const checkResult = input.invariantResults.find(r => r.invariantId === invariant.invariantId);
    const mode = resolveGateMode(policy, invariant.invariantId, input.projectId);
    const passed = checkResult?.passed ?? true; // unknown invariants pass by default

    let action: DecisionLogEntry['action'];
    let reason: string;

    if (passed) {
      action = 'pass';
      reason = `Invariant '${invariant.invariantId}' satisfied`;
    } else {
      switch (mode) {
        case GateMode.ENFORCED:
          action = 'block';
          reason = `Invariant '${invariant.invariantId}' violated (${checkResult?.violationCount ?? 0} violations) — ENFORCED mode blocks`;
          break;
        case GateMode.ASSISTED:
          action = 'block';
          reason = `Invariant '${invariant.invariantId}' violated (${checkResult?.violationCount ?? 0} violations) — ASSISTED mode blocks (override available)`;
          break;
        case GateMode.ADVISORY:
          action = 'warn';
          reason = `Invariant '${invariant.invariantId}' violated (${checkResult?.violationCount ?? 0} violations) — ADVISORY mode warns only`;
          break;
      }
    }

    entries.push({
      invariantId: invariant.invariantId,
      mode,
      passed,
      violationCount: checkResult?.violationCount ?? 0,
      action,
      reason,
    });
  }

  // Check required lane results
  const laneFailures: string[] = [];
  if (input.laneResults) {
    for (const reqLane of requiredLanes) {
      const result = input.laneResults.find(l => l.laneId === reqLane);
      if (result && !result.passed) {
        laneFailures.push(reqLane);
      }
    }
  }

  // Determine overall decision
  const hasBlock = entries.some(e => e.action === 'block');
  const hasWarn = entries.some(e => e.action === 'warn');
  const hasLaneFailures = laneFailures.length > 0;

  let decision: GateDecision;
  let reasoning: string;

  if (hasBlock || hasLaneFailures) {
    decision = GateDecision.FAIL;
    const blockReasons = entries.filter(e => e.action === 'block').map(e => e.invariantId);
    const parts: string[] = [];
    if (blockReasons.length > 0) parts.push(`invariant violations: ${blockReasons.join(', ')}`);
    if (hasLaneFailures) parts.push(`lane failures: ${laneFailures.join(', ')}`);
    reasoning = `Gate FAIL — ${parts.join('; ')}`;
  } else if (hasWarn) {
    decision = GateDecision.ADVISORY_WARN;
    const warnReasons = entries.filter(e => e.action === 'warn').map(e => e.invariantId);
    reasoning = `Gate ADVISORY_WARN — warnings on: ${warnReasons.join(', ')}`;
  } else {
    decision = GateDecision.PASS;
    reasoning = `Gate PASS — all ${entries.length} invariants satisfied, ${requiredLanes.length} required lanes OK`;
  }

  // Compute replay hash
  const replayHash = computeReplayHash(policy.digest, input.digest);

  // Build decision log
  const log: DecisionLog = {
    logId,
    evaluatedAt: new Date().toISOString(),
    entries,
    changeClass,
    requiredLanes,
    laneSummary: input.laneResults,
    decision,
    reasoning,
  };

  // Build gate decision packet
  const packet: GateDecisionPacket = {
    policyBundleDigest: policy.digest,
    contractBundleDigest: policy.changeClassMatrix.version, // simplified: use matrix version
    graphSnapshotDigest: input.graphSnapshotDigest,
    inputSnapshotDigest: input.digest,
    decisionLogRef: logId,
    mode: resolveOverallMode(entries),
    provenanceRef: invocationId,
    builderId: config.builderId,
    invocationId,
    decidedAt: new Date().toISOString(),
    decision,
    replayHash,
  };

  // Persist log if configured
  if (config.persistLogs && config.logDir) {
    persistDecisionLog(log, packet, config.logDir);
  }

  return { packet, log };
}

// ============================================================================
// REPLAY VERIFICATION
// ============================================================================

/**
 * Compute the replay hash from policy + input digests.
 * Same policy + same inputs MUST produce same replay hash.
 */
export function computeReplayHash(policyDigest: string, inputDigest: string): string {
  return createHash('sha256')
    .update(`${policyDigest}:${inputDigest}`)
    .digest('hex');
}

/**
 * Verify that two gate evaluations with the same replay hash
 * produced the same decision.
 */
export function verifyReplayConsistency(
  original: GateDecisionPacket,
  replay: GateDecisionPacket
): { consistent: boolean; details: string } {
  if (original.replayHash !== replay.replayHash) {
    return {
      consistent: false,
      details: `Replay hashes differ — inputs changed. Original: ${original.replayHash.slice(0, 16)}..., Replay: ${replay.replayHash.slice(0, 16)}...`,
    };
  }

  if (original.decision !== replay.decision) {
    return {
      consistent: false,
      details: `Same inputs, different decision! Original: ${original.decision}, Replay: ${replay.decision}. NON-DETERMINISTIC GATE.`,
    };
  }

  return {
    consistent: true,
    details: 'Replay consistent — same inputs, same decision.',
  };
}

// ============================================================================
// INTERNALS
// ============================================================================

/**
 * Determine the overall gate mode from individual entry modes.
 * Most restrictive mode wins.
 */
function resolveOverallMode(entries: DecisionLogEntry[]): GateMode {
  if (entries.some(e => e.mode === GateMode.ENFORCED)) return GateMode.ENFORCED;
  if (entries.some(e => e.mode === GateMode.ASSISTED)) return GateMode.ASSISTED;
  return GateMode.ADVISORY;
}

/**
 * Persist a decision log + packet to disk.
 */
function persistDecisionLog(
  log: DecisionLog,
  packet: GateDecisionPacket,
  logDir: string
): void {
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const filename = `${log.logId}.json`;
  const filepath = join(logDir, filename);
  writeFileSync(filepath, JSON.stringify({ log, packet }, null, 2));
}
