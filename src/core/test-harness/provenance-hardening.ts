/**
 * Provenance Hardening — Full SLSA-Shaped Provenance + Fail-Closed Policy
 *
 * Extends the test provenance schema (N1) with:
 * - Full SLSA-shaped provenance capture for all governed artifacts
 * - Fail-closed policy: missing provenance blocks on required surfaces
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L3
 */

import { createHash } from 'node:crypto';
import {
  TEST_PROVENANCE_SCHEMA_VERSION,
  type TestProvenanceRecord,
} from '../config/test-provenance-schema.js';

// ============================================================================
// SLSA PROVENANCE TYPES (v1.0)
// ============================================================================

/**
 * SLSA-shaped provenance envelope for any governed artifact.
 * Based on SLSA Provenance v1.0 with project-specific extensions.
 */
export interface ProvenanceEnvelope {
  /** Schema version */
  schemaVersion: '1.0.0';
  /** Unique provenance ID */
  provenanceId: string;
  /** When this provenance was captured */
  capturedAt: string;
  /** The subject: what artifact this provenance describes */
  subject: ProvenanceSubject;
  /** The builder: who/what produced the artifact */
  builder: ProvenanceBuilder;
  /** Build metadata */
  buildMetadata: BuildMetadata;
  /** External parameters that influenced the build */
  externalParameters: Record<string, unknown>;
  /** Byproducts produced alongside the artifact */
  byproducts: ProvenanceByproduct[];
  /** Digest of this entire envelope (excluding the digest itself) */
  envelopeDigest: string;
}

export interface ProvenanceSubject {
  /** Artifact name */
  name: string;
  /** Artifact type (snapshot, report, decision, test_result, eval_result) */
  type: 'snapshot' | 'report' | 'decision' | 'test_result' | 'eval_result' | 'gate_decision' | 'metric';
  /** SHA-256 digest of the artifact content */
  digest: string;
  /** Where the artifact is stored */
  uri?: string;
}

export interface ProvenanceBuilder {
  /** Builder ID (e.g., 'watson', 'ci-runner', 'codegraph-watcher') */
  id: string;
  /** Builder version */
  version: string;
  /** Builder type */
  type: 'agent' | 'ci' | 'watcher' | 'manual';
}

export interface BuildMetadata {
  /** Unique invocation ID */
  invocationId: string;
  /** Start time */
  startedAt: string;
  /** End time */
  finishedAt: string;
  /** Duration in ms */
  durationMs: number;
  /** Git commit SHA at build time */
  commitSha: string;
  /** Git branch */
  branch: string;
  /** Whether the working tree was clean */
  cleanWorkingTree: boolean;
}

export interface ProvenanceByproduct {
  /** Byproduct name */
  name: string;
  /** SHA-256 digest */
  digest: string;
  /** URI */
  uri?: string;
}

// ============================================================================
// PROVENANCE CAPTURE
// ============================================================================

/**
 * Capture SLSA-shaped provenance for a governed artifact.
 */
export function captureProvenance(opts: {
  artifactName: string;
  artifactType: ProvenanceSubject['type'];
  artifactContent: string;
  builderId: string;
  builderVersion?: string;
  builderType?: ProvenanceBuilder['type'];
  commitSha: string;
  branch?: string;
  cleanWorkingTree?: boolean;
  externalParameters?: Record<string, unknown>;
  byproducts?: Array<{ name: string; content: string; uri?: string }>;
  startedAt?: string;
}): ProvenanceEnvelope {
  const now = new Date().toISOString();
  const startedAt = opts.startedAt ?? now;
  const invocationId = `prov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const artifactDigest = createHash('sha256').update(opts.artifactContent).digest('hex');

  const byproducts: ProvenanceByproduct[] = (opts.byproducts ?? []).map(bp => ({
    name: bp.name,
    digest: createHash('sha256').update(bp.content).digest('hex'),
    uri: bp.uri,
  }));

  const envelope: ProvenanceEnvelope = {
    schemaVersion: '1.0.0',
    provenanceId: invocationId,
    capturedAt: now,
    subject: {
      name: opts.artifactName,
      type: opts.artifactType,
      digest: artifactDigest,
    },
    builder: {
      id: opts.builderId,
      version: opts.builderVersion ?? '0.1.0',
      type: opts.builderType ?? 'agent',
    },
    buildMetadata: {
      invocationId,
      startedAt,
      finishedAt: now,
      durationMs: new Date(now).getTime() - new Date(startedAt).getTime(),
      commitSha: opts.commitSha,
      branch: opts.branch ?? 'main',
      cleanWorkingTree: opts.cleanWorkingTree ?? true,
    },
    externalParameters: opts.externalParameters ?? {},
    byproducts,
    envelopeDigest: '',
  };

  envelope.envelopeDigest = computeEnvelopeDigest(envelope);
  return envelope;
}

// ============================================================================
// PROVENANCE VERIFICATION
// ============================================================================

/**
 * Verify a provenance envelope's integrity.
 */
export function verifyProvenanceEnvelope(envelope: ProvenanceEnvelope): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check digest
  const expectedDigest = computeEnvelopeDigest(envelope);
  if (envelope.envelopeDigest !== expectedDigest) {
    issues.push('Envelope digest mismatch — content may have been tampered');
  }

  // Check required fields
  if (!envelope.subject.name) issues.push('Missing subject name');
  if (!envelope.subject.digest) issues.push('Missing subject digest');
  if (!envelope.builder.id) issues.push('Missing builder ID');
  if (!envelope.buildMetadata.commitSha) issues.push('Missing commit SHA');
  if (!envelope.buildMetadata.invocationId) issues.push('Missing invocation ID');

  return { valid: issues.length === 0, issues };
}

/**
 * Verify that an artifact's content matches its provenance digest.
 */
export function verifyArtifactDigest(
  artifactContent: string,
  envelope: ProvenanceEnvelope
): boolean {
  const actualDigest = createHash('sha256').update(artifactContent).digest('hex');
  return actualDigest === envelope.subject.digest;
}

// ============================================================================
// FAIL-CLOSED POLICY
// ============================================================================

export type RequiredSurface =
  | 'integrity_snapshot'
  | 'governance_metrics'
  | 'gate_decision'
  | 'verification_run'
  | 'eval_result'
  | 'commit_audit';

export interface ProvenancePolicy {
  /** Surfaces that require provenance */
  requiredSurfaces: RequiredSurface[];
  /** Whether missing provenance blocks (true) or warns (false) */
  failClosed: boolean;
  /** Grace period before fail-closed kicks in (days) */
  gracePeriodDays: number;
  /** When the policy was activated */
  activatedAt: string;
}

export const DEFAULT_PROVENANCE_POLICY: ProvenancePolicy = {
  requiredSurfaces: [
    'integrity_snapshot',
    'governance_metrics',
    'gate_decision',
    'verification_run',
    'commit_audit',
  ],
  failClosed: true,
  gracePeriodDays: 0,
  activatedAt: '2026-03-14T00:00:00.000Z',
};

/**
 * Check whether an artifact on a required surface has provenance.
 * Returns pass/fail + details.
 */
export function checkProvenanceRequirement(
  surface: RequiredSurface,
  envelope: ProvenanceEnvelope | null,
  policy: ProvenancePolicy = DEFAULT_PROVENANCE_POLICY
): { passed: boolean; action: 'pass' | 'warn' | 'block'; details: string } {
  // Check if this surface requires provenance
  if (!policy.requiredSurfaces.includes(surface)) {
    return { passed: true, action: 'pass', details: `Surface '${surface}' does not require provenance` };
  }

  if (!envelope) {
    if (policy.failClosed) {
      return { passed: false, action: 'block', details: `Missing provenance on required surface '${surface}' — BLOCKED (fail-closed)` };
    }
    return { passed: false, action: 'warn', details: `Missing provenance on required surface '${surface}' — WARNING` };
  }

  // Verify envelope integrity
  const { valid, issues } = verifyProvenanceEnvelope(envelope);
  if (!valid) {
    return { passed: false, action: 'block', details: `Invalid provenance on '${surface}': ${issues.join(', ')}` };
  }

  return { passed: true, action: 'pass', details: `Provenance verified for '${surface}'` };
}

// ============================================================================
// INTERNALS
// ============================================================================

function computeEnvelopeDigest(envelope: ProvenanceEnvelope): string {
  const { envelopeDigest: _, ...content } = envelope;
  // Use a replacer function that sorts keys at every level for canonical serialization
  const canonical = JSON.stringify(content, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(value).sort()) {
        sorted[k] = value[k];
      }
      return sorted;
    }
    return value;
  });
  return createHash('sha256').update(canonical).digest('hex');
}
