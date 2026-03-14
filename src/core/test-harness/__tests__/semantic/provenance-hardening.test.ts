/**
 * L3: Provenance Hardening Expansion — Test Suite
 *
 * Tests the two L3 tasks:
 * 1. Full SLSA-shaped provenance for all governed artifacts
 * 2. Policy: missing provenance fails closed on required surfaces
 *
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone L3
 */

import { strict as assert } from 'node:assert';
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

function setup() { setupHermeticEnv({ frozenClock: '2026-03-14T00:00:00.000Z' }); }
function teardown() { teardownHermeticEnv(); }

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void) {
  setup();
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err: any) { failed++; console.log(`  ✗ ${name}\n    ${err.message}`); }
  finally { teardown(); }
}

console.log('\n=== L3: Provenance Hardening Expansion ===\n');

// --- Task 1: Full SLSA-shaped provenance ---

console.log('Task 1: Full SLSA-shaped provenance for all governed artifacts');

await test('captureProvenance produces valid envelope', () => {
  const envelope = captureProvenance({
    artifactName: 'integrity-snapshot-2026-03-14',
    artifactType: 'snapshot',
    artifactContent: '{"nodes": 100, "edges": 500}',
    builderId: 'watson',
    commitSha: 'abc123',
  });

  assert.equal(envelope.schemaVersion, '1.0.0');
  assert.ok(envelope.provenanceId.startsWith('prov_'));
  assert.ok(envelope.subject.digest.length === 64);
  assert.equal(envelope.subject.name, 'integrity-snapshot-2026-03-14');
  assert.equal(envelope.subject.type, 'snapshot');
  assert.equal(envelope.builder.id, 'watson');
  assert.equal(envelope.buildMetadata.commitSha, 'abc123');
  assert.ok(envelope.envelopeDigest.length === 64);
});

await test('envelope digest is deterministic for same content', () => {
  const opts = {
    artifactName: 'test',
    artifactType: 'report' as const,
    artifactContent: 'same content',
    builderId: 'test',
    commitSha: 'deadbeef',
  };
  const e1 = captureProvenance(opts);
  const e2 = captureProvenance(opts);
  // Subject digests should match (same content)
  assert.equal(e1.subject.digest, e2.subject.digest);
});

await test('verifyProvenanceEnvelope passes for valid envelope', () => {
  const envelope = captureProvenance({
    artifactName: 'test',
    artifactType: 'metric',
    artifactContent: '42',
    builderId: 'test',
    commitSha: 'abc123',
  });
  const { valid, issues } = verifyProvenanceEnvelope(envelope);
  assert.ok(valid, `Should be valid but got issues: ${issues.join(', ')}`);
});

await test('verifyProvenanceEnvelope detects tampering', () => {
  const envelope = captureProvenance({
    artifactName: 'test',
    artifactType: 'metric',
    artifactContent: '42',
    builderId: 'test',
    commitSha: 'abc123',
  });
  // Deep clone then tamper — keeping the OLD digest but changing content
  const tampered: ProvenanceEnvelope = JSON.parse(JSON.stringify(envelope));
  tampered.subject.name = 'TAMPERED';
  // envelopeDigest is still the old one, so verification should fail
  const { valid } = verifyProvenanceEnvelope(tampered);
  assert.ok(!valid, 'Tampered envelope should fail verification');
});

await test('verifyArtifactDigest validates content', () => {
  const content = '{"important": "data"}';
  const envelope = captureProvenance({
    artifactName: 'test',
    artifactType: 'snapshot',
    artifactContent: content,
    builderId: 'test',
    commitSha: 'abc123',
  });
  assert.ok(verifyArtifactDigest(content, envelope));
  assert.ok(!verifyArtifactDigest('different content', envelope));
});

await test('byproducts are captured with digests', () => {
  const envelope = captureProvenance({
    artifactName: 'main-artifact',
    artifactType: 'gate_decision',
    artifactContent: '{"decision": "pass"}',
    builderId: 'test',
    commitSha: 'abc123',
    byproducts: [
      { name: 'decision-log', content: '{"entries": []}' },
      { name: 'input-snapshot', content: '{"files": []}' },
    ],
  });
  assert.equal(envelope.byproducts.length, 2);
  assert.ok(envelope.byproducts[0].digest.length === 64);
  assert.equal(envelope.byproducts[0].name, 'decision-log');
});

await test('all artifact types are supported', () => {
  const types: Array<'snapshot' | 'report' | 'decision' | 'test_result' | 'eval_result' | 'gate_decision' | 'metric'> = [
    'snapshot', 'report', 'decision', 'test_result', 'eval_result', 'gate_decision', 'metric',
  ];
  for (const type of types) {
    const envelope = captureProvenance({
      artifactName: `test-${type}`,
      artifactType: type,
      artifactContent: `{"type": "${type}"}`,
      builderId: 'test',
      commitSha: 'abc123',
    });
    assert.equal(envelope.subject.type, type);
  }
});

// --- Task 2: Fail-closed policy ---

console.log('\nTask 2: Missing provenance fails closed on required surfaces');

await test('default policy covers 5 required surfaces', () => {
  assert.equal(DEFAULT_PROVENANCE_POLICY.requiredSurfaces.length, 5);
  assert.ok(DEFAULT_PROVENANCE_POLICY.failClosed);
  assert.equal(DEFAULT_PROVENANCE_POLICY.gracePeriodDays, 0);
});

await test('valid provenance on required surface passes', () => {
  const envelope = captureProvenance({
    artifactName: 'integrity-snapshot',
    artifactType: 'snapshot',
    artifactContent: '{}',
    builderId: 'test',
    commitSha: 'abc123',
  });
  const check = checkProvenanceRequirement('integrity_snapshot', envelope);
  assert.ok(check.passed);
  assert.equal(check.action, 'pass');
});

await test('missing provenance on required surface blocks (fail-closed)', () => {
  const check = checkProvenanceRequirement('gate_decision', null);
  assert.ok(!check.passed);
  assert.equal(check.action, 'block');
  assert.ok(check.details.includes('BLOCKED'));
});

await test('missing provenance with failClosed=false warns instead of blocking', () => {
  const relaxed: ProvenancePolicy = {
    ...DEFAULT_PROVENANCE_POLICY,
    failClosed: false,
  };
  const check = checkProvenanceRequirement('gate_decision', null, relaxed);
  assert.ok(!check.passed);
  assert.equal(check.action, 'warn');
  assert.ok(check.details.includes('WARNING'));
});

await test('non-required surface passes without provenance', () => {
  const policy: ProvenancePolicy = {
    requiredSurfaces: ['gate_decision'],
    failClosed: true,
    gracePeriodDays: 0,
    activatedAt: '2026-03-14T00:00:00.000Z',
  };
  // 'integrity_snapshot' is not required in this policy
  const check = checkProvenanceRequirement('integrity_snapshot', null, policy);
  assert.ok(check.passed);
  assert.equal(check.action, 'pass');
});

await test('tampered provenance blocks even on required surface', () => {
  const envelope = captureProvenance({
    artifactName: 'test',
    artifactType: 'gate_decision',
    artifactContent: '{}',
    builderId: 'test',
    commitSha: 'abc123',
  });
  // Deep clone then tamper — keeping OLD digest
  const tampered: ProvenanceEnvelope = JSON.parse(JSON.stringify(envelope));
  tampered.subject.name = 'TAMPERED';
  const check = checkProvenanceRequirement('gate_decision', tampered);
  assert.ok(!check.passed);
  assert.equal(check.action, 'block');
});

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
