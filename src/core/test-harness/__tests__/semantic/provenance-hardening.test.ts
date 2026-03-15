/**
 * L3: Provenance Hardening Expansion — Test Suite
 *
 * Tests the two L3 tasks:
 * 1. Full SLSA-shaped provenance for all governed artifacts
 * 2. Policy: missing provenance fails closed on required surfaces
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L3
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupHermeticEnv,
  teardownHermeticEnv,
  captureProvenance,
  verifyProvenanceEnvelope,
  verifyArtifactDigest,
  checkProvenanceRequirement,
  DEFAULT_PROVENANCE_POLICY,
  type ProvenanceEnvelope,
  type ProvenancePolicy,
} from '../../index.js';

describe('L3: Provenance Hardening Expansion', () => {
  beforeEach(() => { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); });
  afterEach(() => { teardownHermeticEnv(); });

  describe('Task 1: Full SLSA-shaped provenance', () => {
    it('captureProvenance produces valid envelope', () => {
      const envelope = captureProvenance({
        artifactName: 'integrity-snapshot-2026-03-14', artifactType: 'snapshot',
        artifactContent: '{"nodes": 100, "edges": 500}', builderId: 'watson', commitSha: 'abc123',
      });
      expect(envelope.schemaVersion).toBe('1.0.0');
      expect(envelope.provenanceId).toMatch(/^prov_/);
      expect(envelope.subject.digest).toHaveLength(64);
      expect(envelope.subject.name).toBe('integrity-snapshot-2026-03-14');
      expect(envelope.subject.type).toBe('snapshot');
      expect(envelope.builder.id).toBe('watson');
      expect(envelope.buildMetadata.commitSha).toBe('abc123');
      expect(envelope.envelopeDigest).toHaveLength(64);
    });

    it('envelope digest is deterministic for same content', () => {
      const opts = { artifactName: 'test', artifactType: 'report' as const, artifactContent: 'same content', builderId: 'test', commitSha: 'deadbeef' };
      const e1 = captureProvenance(opts);
      const e2 = captureProvenance(opts);
      expect(e1.subject.digest).toBe(e2.subject.digest);
    });

    it('verifyProvenanceEnvelope passes for valid envelope', () => {
      const envelope = captureProvenance({ artifactName: 'test', artifactType: 'metric', artifactContent: '42', builderId: 'test', commitSha: 'abc123' });
      const { valid, issues } = verifyProvenanceEnvelope(envelope);
      expect(valid).toBe(true);
      expect(issues).toHaveLength(0);
    });

    it('verifyProvenanceEnvelope detects tampering', () => {
      const envelope = captureProvenance({ artifactName: 'test', artifactType: 'metric', artifactContent: '42', builderId: 'test', commitSha: 'abc123' });
      const tampered: ProvenanceEnvelope = JSON.parse(JSON.stringify(envelope));
      tampered.subject.name = 'TAMPERED';
      const { valid } = verifyProvenanceEnvelope(tampered);
      expect(valid).toBe(false);
    });

    it('verifyArtifactDigest validates content', () => {
      const content = '{"important": "data"}';
      const envelope = captureProvenance({ artifactName: 'test', artifactType: 'snapshot', artifactContent: content, builderId: 'test', commitSha: 'abc123' });
      expect(verifyArtifactDigest(content, envelope)).toBe(true);
      expect(verifyArtifactDigest('different content', envelope)).toBe(false);
    });

    it('byproducts are captured with digests', () => {
      const envelope = captureProvenance({
        artifactName: 'main-artifact', artifactType: 'gate_decision', artifactContent: '{"decision": "pass"}', builderId: 'test', commitSha: 'abc123',
        byproducts: [{ name: 'decision-log', content: '{"entries": []}' }, { name: 'input-snapshot', content: '{"files": []}' }],
      });
      expect(envelope.byproducts).toHaveLength(2);
      expect(envelope.byproducts[0].digest).toHaveLength(64);
      expect(envelope.byproducts[0].name).toBe('decision-log');
    });

    it('all artifact types are supported', () => {
      const types: Array<'snapshot' | 'report' | 'decision' | 'test_result' | 'eval_result' | 'gate_decision' | 'metric'> = [
        'snapshot', 'report', 'decision', 'test_result', 'eval_result', 'gate_decision', 'metric',
      ];
      for (const type of types) {
        const envelope = captureProvenance({ artifactName: `test-${type}`, artifactType: type, artifactContent: `{"type": "${type}"}`, builderId: 'test', commitSha: 'abc123' });
        expect(envelope.subject.type).toBe(type);
      }
    });
  });

  describe('Task 2: Missing provenance fails closed', () => {
    it('default policy covers 5 required surfaces', () => {
      expect(DEFAULT_PROVENANCE_POLICY.requiredSurfaces).toHaveLength(5);
      expect(DEFAULT_PROVENANCE_POLICY.failClosed).toBe(true);
      expect(DEFAULT_PROVENANCE_POLICY.gracePeriodDays).toBe(0);
    });

    it('valid provenance on required surface passes', () => {
      const envelope = captureProvenance({ artifactName: 'integrity-snapshot', artifactType: 'snapshot', artifactContent: '{}', builderId: 'test', commitSha: 'abc123' });
      const check = checkProvenanceRequirement('integrity_snapshot', envelope);
      expect(check.passed).toBe(true);
      expect(check.action).toBe('pass');
    });

    it('missing provenance on required surface blocks (fail-closed)', () => {
      const check = checkProvenanceRequirement('gate_decision', null);
      expect(check.passed).toBe(false);
      expect(check.action).toBe('block');
      expect(check.details).toContain('BLOCKED');
    });

    it('missing provenance with failClosed=false warns instead of blocking', () => {
      const relaxed: ProvenancePolicy = { ...DEFAULT_PROVENANCE_POLICY, failClosed: false };
      const check = checkProvenanceRequirement('gate_decision', null, relaxed);
      expect(check.passed).toBe(false);
      expect(check.action).toBe('warn');
      expect(check.details).toContain('WARNING');
    });

    it('non-required surface passes without provenance', () => {
      const policy: ProvenancePolicy = { requiredSurfaces: ['gate_decision'], failClosed: true, gracePeriodDays: 0, activatedAt: '2026-03-14T00:00:00.000Z' };
      const check = checkProvenanceRequirement('integrity_snapshot', null, policy);
      expect(check.passed).toBe(true);
      expect(check.action).toBe('pass');
    });

    it('tampered provenance blocks even on required surface', () => {
      const envelope = captureProvenance({ artifactName: 'test', artifactType: 'gate_decision', artifactContent: '{}', builderId: 'test', commitSha: 'abc123' });
      const tampered: ProvenanceEnvelope = JSON.parse(JSON.stringify(envelope));
      tampered.subject.name = 'TAMPERED';
      const check = checkProvenanceRequirement('gate_decision', tampered);
      expect(check.passed).toBe(false);
      expect(check.action).toBe('block');
    });
  });
});
