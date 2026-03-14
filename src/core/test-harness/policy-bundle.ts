/**
 * Policy Bundle — Pinned Governance Configuration
 *
 * A policy bundle is a frozen snapshot of all governance policies
 * (invariant registry, change-class matrix, gate mode overrides).
 * Each bundle is pinned by a SHA-256 digest so gate decisions
 * can reference exactly which policy version produced them.
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone X1, Task 1
 */

import { createHash } from 'node:crypto';
import {
  INVARIANT_REGISTRY,
  INVARIANT_REGISTRY_SCHEMA_VERSION,
  type InvariantDefinition,
  EnforcementMode,
} from '../config/invariant-registry-schema.js';
import {
  CHANGE_CLASS_MATRIX,
  CHANGE_CLASS_MATRIX_VERSION,
  type ChangeClassDefinition,
  type ChangeClass,
} from '../config/change-class-matrix.js';
import {
  GateMode,
  GATE_DECISION_PACKET_SCHEMA_VERSION,
} from '../config/gate-decision-packet-schema.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A frozen, digest-pinned governance policy bundle.
 * Immutable once created — all fields contribute to the digest.
 */
export interface PolicyBundle {
  /** Schema version */
  schemaVersion: '1.0.0';
  /** When this bundle was assembled */
  assembledAt: string;
  /** Pinning digest (SHA-256 of all policy content) */
  digest: string;
  /** Invariant registry snapshot */
  invariants: {
    version: string;
    definitions: InvariantDefinition[];
  };
  /** Change-class matrix snapshot */
  changeClassMatrix: {
    version: string;
    definitions: Record<string, ChangeClassDefinition>;
  };
  /** Gate mode overrides (project-specific or global) */
  gateModeOverrides: GateModeOverride[];
  /** Default gate mode when no override applies */
  defaultGateMode: GateMode;
  /** Waiver policies */
  waiverPolicy: WaiverPolicy;
}

export interface GateModeOverride {
  /** Invariant ID or '*' for global */
  invariantId: string;
  /** Optional project scope (null = global) */
  projectId: string | null;
  /** Override mode */
  mode: GateMode;
  /** Reason for override */
  reason: string;
  /** Optional expiry (ISO timestamp) */
  expiresAt?: string;
}

export interface WaiverPolicy {
  /** Maximum waiver duration in days */
  maxDurationDays: number;
  /** Require reason for all waivers */
  requireReason: boolean;
  /** Who can issue waivers */
  issuerRoles: string[];
  /** Auto-expire waivers after this many days of inactivity */
  autoExpireInactiveDays: number;
}

// ============================================================================
// BUNDLE ASSEMBLY
// ============================================================================

/**
 * Assemble a policy bundle from current governance state.
 * The bundle is frozen and pinned by digest.
 */
export function assemblePolicyBundle(opts?: {
  gateModeOverrides?: GateModeOverride[];
  defaultGateMode?: GateMode;
  waiverPolicy?: Partial<WaiverPolicy>;
  invariants?: InvariantDefinition[];
  changeClassMatrix?: Record<string, ChangeClassDefinition>;
}): PolicyBundle {
  const bundle: PolicyBundle = {
    schemaVersion: '1.0.0',
    assembledAt: new Date().toISOString(),
    digest: '', // computed below
    invariants: {
      version: INVARIANT_REGISTRY_SCHEMA_VERSION,
      definitions: opts?.invariants ?? [...INVARIANT_REGISTRY],
    },
    changeClassMatrix: {
      version: CHANGE_CLASS_MATRIX_VERSION,
      definitions: opts?.changeClassMatrix ?? { ...CHANGE_CLASS_MATRIX },
    },
    gateModeOverrides: opts?.gateModeOverrides ?? [],
    defaultGateMode: opts?.defaultGateMode ?? GateMode.ENFORCED,
    waiverPolicy: {
      maxDurationDays: 90,
      requireReason: true,
      issuerRoles: ['governance', 'owner'],
      autoExpireInactiveDays: 30,
      ...opts?.waiverPolicy,
    },
  };

  bundle.digest = computeBundleDigest(bundle);
  return Object.freeze(bundle) as PolicyBundle;
}

// ============================================================================
// DIGEST
// ============================================================================

/**
 * Compute SHA-256 digest of policy bundle content.
 * Excludes the digest field itself and assembledAt (timestamp shouldn't affect identity).
 */
export function computeBundleDigest(bundle: PolicyBundle): string {
  const { digest: _, assembledAt: __, ...content } = bundle;
  const canonical = JSON.stringify(content, Object.keys(content).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify a policy bundle's digest matches its content.
 */
export function verifyBundleDigest(bundle: PolicyBundle): boolean {
  return bundle.digest === computeBundleDigest(bundle);
}

// ============================================================================
// POLICY RESOLUTION
// ============================================================================

/**
 * Resolve the effective gate mode for a given invariant in a project context.
 * Override chain: specific invariant+project > specific invariant+global > default.
 */
export function resolveGateMode(
  bundle: PolicyBundle,
  invariantId: string,
  projectId: string | null = null,
  now: Date = new Date()
): GateMode {
  // Find most specific non-expired override
  const overrides = bundle.gateModeOverrides
    .filter(o => {
      // Match invariant (exact or wildcard)
      if (o.invariantId !== invariantId && o.invariantId !== '*') return false;
      // Match project (exact or global)
      if (o.projectId !== null && o.projectId !== projectId) return false;
      // Check expiry
      if (o.expiresAt && new Date(o.expiresAt) < now) return false;
      return true;
    })
    .sort((a, b) => {
      // Most specific first: exact invariant > wildcard, exact project > global
      const aSpec = (a.invariantId !== '*' ? 2 : 0) + (a.projectId !== null ? 1 : 0);
      const bSpec = (b.invariantId !== '*' ? 2 : 0) + (b.projectId !== null ? 1 : 0);
      return bSpec - aSpec;
    });

  if (overrides.length > 0) return overrides[0].mode;

  // Fall back to invariant's own enforcement mode mapped to GateMode
  const invariant = bundle.invariants.definitions.find(i => i.invariantId === invariantId);
  if (invariant) {
    switch (invariant.enforcementMode) {
      case EnforcementMode.ENFORCED: return GateMode.ENFORCED;
      case EnforcementMode.ASSISTED: return GateMode.ASSISTED;
      case EnforcementMode.ADVISORY: return GateMode.ADVISORY;
    }
  }

  return bundle.defaultGateMode;
}

/**
 * Get all invariants that apply to a given change class.
 * Returns invariants whose scope matches the change's affected areas.
 */
export function getApplicableInvariants(
  bundle: PolicyBundle,
  changeClass: ChangeClass
): InvariantDefinition[] {
  // All hard invariants always apply
  // Advisory invariants apply based on change class lanes
  const matrix = bundle.changeClassMatrix.definitions[changeClass];
  if (!matrix) return bundle.invariants.definitions;

  // For now, return all invariants — lane filtering happens at gate evaluation
  return [...bundle.invariants.definitions];
}
