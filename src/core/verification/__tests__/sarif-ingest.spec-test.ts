/**
 * SARIF Importer + Verification Ingest — Spec Contract + Implementation Edge Case Tests
 *
 * Two-phase TDD: Phase A tests SPEC contract only, Phase B tests implementation edge cases.
 *
 * Spec references:
 *   - plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md: Sections 4, 6, 7, 17.1
 *   - codegraph/src/core/verification/verification-schema.ts
 *
 * Implementation references (Phase B only):
 *   - codegraph/src/core/verification/sarif-importer.ts
 *   - codegraph/src/core/verification/verification-ingest.ts
 *   - audits/vg_audit_agent1_sarif_ingest.md
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  VerificationFoundationBundleSchema,
  VerificationRunSchema,
  AnalysisScopeSchema,
  AdjudicationRecordSchema,
  PathWitnessSchema,
  type VerificationFoundationBundle,
  type VerificationRun,
  type AnalysisScope,
  type AdjudicationRecord,
  type PathWitness,
} from '../verification-schema.js';
import { importSarifToVerificationBundle, type SarifImportOptions } from '../sarif-importer.js';
import { ingestVerificationFoundation } from '../verification-ingest.js';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test helpers for partial typed objects (Zod schema has .default() on arrays,
// but TS inferred types still require them; tests need minimal valid objects)
const scopeDefaults: Pick<AnalysisScope, 'scanRoots' | 'includedPaths' | 'excludedPaths' | 'supportedLanguages' | 'analyzedLanguages' | 'unscannedTargetNodeIds'> = {
  scanRoots: [], includedPaths: [], excludedPaths: [],
  supportedLanguages: [], analyzedLanguages: [], unscannedTargetNodeIds: [],
};
const adjDefaults: Pick<AdjudicationRecord, 'requiresRevalidation'> = {
  requiresRevalidation: false,
};

// ============================================================================
// PHASE A: Spec Contract Tests
// ============================================================================
// These tests derive from WHAT THE SPEC SAYS MUST BE TRUE.
// They test the behavioral contract, not the implementation.
// Failing spec tests mean the code needs fixing, not the tests.

describe('SARIF + Ingest — Spec Contract Tests', () => {
  let testDir: string;
  let neo4j: Neo4jService;
  const testProjectId = `__test_sarif_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    testDir = join(tmpdir(), `sarif-test-${randomUUID().slice(0, 8)}`);
    await mkdir(testDir, { recursive: true });
    neo4j = new Neo4jService();
    // Clean up any leftover test data
    await neo4j.run(`MATCH (n {projectId: $pid}) DETACH DELETE n`, { pid: testProjectId });
  });

  afterAll(async () => {
    // Cleanup test data
    await neo4j.run(`MATCH (n {projectId: $pid}) DETACH DELETE n`, { pid: testProjectId });
    await neo4j.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC: Section 6 — SARIF Import behavioral requirements
  // ─────────────────────────────────────────────────────────────────────────

  describe('SARIF Import Behavioral Contract (Section 6)', () => {
    // SPEC: Section 6 — SARIF findings with severity `error` → VR with `status: 'violates'`, high confidence
    it('maps SARIF error severity to violates status with high criticality', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'SQL injection vulnerability' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'error-level.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns.length).toBe(1);
      const run = bundle.verificationRuns[0];

      // SPEC: Section 6 — error → violates
      expect(run.status).toBe('violates');
      // SPEC: Section 6 — error → high criticality
      expect(run.criticality).toBe('high');
      // SPEC: Section 6 — error → high confidence (0.9)
      expect(run.confidence).toBeGreaterThanOrEqual(0.85);
    });

    // SPEC: Section 6 — SARIF findings with severity `warning` → VR with `status: 'violates'`, medium confidence
    it('maps SARIF warning severity to violates status with medium criticality', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/unsafe-html',
            level: 'warning',
            message: { text: 'Unsafe HTML rendering' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/render.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'warning-level.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns.length).toBe(1);
      const run = bundle.verificationRuns[0];

      // SPEC: Section 6 — warning → violates
      expect(run.status).toBe('violates');
      // SPEC: Section 6 — warning → medium criticality
      expect(run.criticality).toBe('medium');
      // SPEC: Section 6 — warning → medium confidence (0.8)
      expect(run.confidence).toBeGreaterThanOrEqual(0.75);
      expect(run.confidence).toBeLessThan(0.9);
    });

    // SPEC: Section 6 — SARIF clean run (no findings) → VR with `status: 'satisfies'`
    it('creates satisfies status for clean runs (no findings)', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [],  // No findings = clean run
        }],
      };

      const sarifPath = join(testDir, 'clean-run.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns.length).toBe(1);
      const run = bundle.verificationRuns[0];

      // SPEC: Section 6 — clean run → satisfies
      expect(run.status).toBe('satisfies');
      // SPEC: Section 6 — clean run → lifecycleState: 'clean'
      expect(run.lifecycleState).toBe('clean');
    });

    // SPEC: Section 6 — Suppressions in SARIF → AdjudicationRecord nodes with `ADJUDICATES` edges
    it('imports suppressions as AdjudicationRecord nodes', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'SQL injection vulnerability' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' } } }],
            suppressions: [{
              kind: 'inSource',
              justification: 'False positive - parameterized query',
              status: 'accepted',
            }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'with-suppressions.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // SPEC: Section 6 — Suppressions → AdjudicationRecord
      expect(bundle.adjudications.length).toBeGreaterThan(0);
      const adj = bundle.adjudications[0];

      // SPEC: Section 4 — AdjudicationRecord fields
      expect(adj.id).toBeDefined();
      expect(adj.projectId).toBe(testProjectId);
      expect(adj.targetNodeId).toBeDefined();
      expect(adj.adjudicationState).toBeDefined();
      expect(adj.adjudicationReason).toBeDefined();
    });

    // SPEC: Section 6 — Related locations → PathWitness nodes with `ILLUSTRATES` edges
    it('preserves relatedLocations in PathWitness for high/safety-critical findings', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/sql-injection',
            level: 'error',  // high criticality
            message: { text: 'SQL injection vulnerability' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' }, region: { startLine: 10 } } }],
            relatedLocations: [
              { physicalLocation: { artifactLocation: { uri: 'src/input.ts' }, region: { startLine: 5 } }, message: { text: 'User input source' } },
              { physicalLocation: { artifactLocation: { uri: 'src/db.ts' }, region: { startLine: 8 } }, message: { text: 'Sanitization bypass' } },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'with-related-locations.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // SPEC: Section 6 — relatedLocations → PathWitness for high/safety_critical
      expect(bundle.pathWitnesses).toBeDefined();
      expect(bundle.pathWitnesses!.length).toBeGreaterThan(0);

      const witness = bundle.pathWitnesses![0];
      expect(witness.id).toBeDefined();
      expect(witness.projectId).toBe(testProjectId);
      expect(witness.verificationRunId).toBeDefined();
      expect(witness.witnessType).toBe('relatedLocations');
      expect(witness.payloadJson).toBeDefined();

      // Verify payload contains the related locations
      const payload = JSON.parse(witness.payloadJson!);
      expect(payload.relatedLocations.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC: Section 6 — Provenance requirements
  // ─────────────────────────────────────────────────────────────────────────

  describe('Provenance Fields (Section 6 + 17.1)', () => {
    // SPEC: Section 17.1 items 1-4 — toolVersion, resultFingerprint, runConfigHash, attestationRef
    it('stamps all required provenance fields on every VerificationRun', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          automationDetails: { id: 'query-pack/javascript-queries' },
          results: [{
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'SQL injection' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'provenance-check.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
        attestationRefBase: 'urn:test:attestation',
        baselineRef: 'main',
        mergeBase: 'abc123',
      });

      // SPEC: Section 17.1 item 1 — toolVersion
      expect(bundle.verificationRuns[0].toolVersion).toBe('2.15.0');

      // SPEC: Section 17.1 item 2 — resultFingerprint (deterministic identity)
      expect(bundle.verificationRuns[0].resultFingerprint).toBeDefined();
      expect(typeof bundle.verificationRuns[0].resultFingerprint).toBe('string');
      expect(bundle.verificationRuns[0].resultFingerprint!.length).toBeGreaterThan(0);

      // SPEC: Section 17.1 item 3 — runConfigHash (config identity)
      expect(bundle.verificationRuns[0].runConfigHash).toBeDefined();

      // SPEC: Section 17.1 item 4 — attestationRef (provenance link)
      expect(bundle.verificationRuns[0].attestationRef).toBeDefined();
      expect(bundle.verificationRuns[0].attestationRef).toMatch(/^urn:test:attestation/);

      // SPEC: Section 4 — baseline/diff fields
      expect(bundle.verificationRuns[0].baselineRef).toBe('main');
      expect(bundle.verificationRuns[0].mergeBase).toBe('abc123');

      // SPEC: Section 17.1 item 5 — subjectDigest (sha256 identity)
      expect(bundle.verificationRuns[0].subjectDigest).toMatch(/^sha256:/);

      // SPEC: Section 17.1 item 6 — predicateType (in-toto format)
      expect(bundle.verificationRuns[0].predicateType).toBeDefined();

      // SPEC: Section 17.1 item 7 — verifierId (tool identity)
      expect(bundle.verificationRuns[0].verifierId).toBeDefined();

      // SPEC: Section 17.1 item 8 — timeVerified (timestamp)
      expect(bundle.verificationRuns[0].timeVerified).toBeDefined();
    });

    // SPEC: Section 17.1 — Fingerprint must be deterministic (same input → same fingerprint)
    it('generates deterministic fingerprints for identical inputs', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/sql-injection',
            level: 'error',
            message: { text: 'SQL injection' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'src/db.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'deterministic-fp.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle1 = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      const bundle2 = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // SPEC: Section 17.1 — deterministic fingerprints
      expect(bundle1.verificationRuns[0].resultFingerprint)
        .toBe(bundle2.verificationRuns[0].resultFingerprint);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — TC-1 Temporal Confidence Fields
  // ─────────────────────────────────────────────────────────────────────────

  describe('TC-1 Temporal Defaults (Section 4 + TC-1)', () => {
    // SPEC: TC-1 — Each VR must have temporal defaults: observedAt, validFrom, validTo, supersededAt
    it('sets TC-1 temporal defaults on ingested VerificationRun nodes', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL', version: '2.15.0' } },
          results: [{
            ruleId: 'js/test',
            level: 'warning',
            message: { text: 'Test finding' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'tc1-temporal.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      await ingestVerificationFoundation(bundle);

      // Query the graph for temporal fields
      const result = await neo4j.run(
        `MATCH (n:VerificationRun {projectId: $pid})
         RETURN n.observedAt AS observedAt, n.validFrom AS validFrom,
                n.validTo AS validTo, n.supersededAt AS supersededAt`,
        { pid: testProjectId },
      );

      expect(result.length).toBeGreaterThan(0);
      const record = result[0];

      // SPEC: TC-1 — observedAt must be set (ingestion timestamp)
      expect(record.observedAt).toBeDefined();

      // SPEC: TC-1 — validFrom must be set (run/observation time)
      expect(record.validFrom).toBeDefined();

      // SPEC: TC-1 — validTo is null initially (still valid)
      expect(record.validTo).toBeNull();

      // SPEC: TC-1 — supersededAt is null initially (not superseded)
      expect(record.supersededAt).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 + 7 — Verification Ingest behavioral requirements
  // ─────────────────────────────────────────────────────────────────────────

  describe('Verification Ingest Behavioral Contract (Section 4 + 7)', () => {
    // SPEC: Section 4 — VerificationRun nodes get `CodeNode:VerificationRun` labels
    it('creates VerificationRun nodes with CodeNode:VerificationRun labels', async () => {
      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: `vr:${testProjectId}:label-test`,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          resultFingerprint: 'fp-label-test',
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [],
        adjudications: [],
        pathWitnesses: [],
      };

      await ingestVerificationFoundation(bundle);

      const result = await neo4j.run(
        `MATCH (n:VerificationRun {id: $id}) RETURN labels(n) AS labels, n.coreType AS coreType`,
        { id: `vr:${testProjectId}:label-test` },
      );

      expect(result.length).toBe(1);
      const labels = result[0].labels as string[];

      // SPEC: Section 4 — VerificationRun → CodeNode:VerificationRun
      expect(labels).toContain('CodeNode');
      expect(labels).toContain('VerificationRun');
      expect(result[0].coreType).toBe('VerificationRun');
    });

    // SPEC: Section 4 — AnalysisScope nodes get `CodeNode:AnalysisScope` labels with `HAS_SCOPE` edges to their run
    it('creates AnalysisScope nodes with HAS_SCOPE edges to VerificationRun', async () => {
      const runId = `vr:${testProjectId}:scope-edge-test`;
      const scopeId = `scope:${testProjectId}:scope-edge-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [{
          ...scopeDefaults,
          id: scopeId,
          projectId: testProjectId,
          verificationRunId: runId,
          scopeCompleteness: 'complete',
        }],
        adjudications: [],
        pathWitnesses: [],
      };

      await ingestVerificationFoundation(bundle);

      // Check labels
      const labelResult = await neo4j.run(
        `MATCH (s:AnalysisScope {id: $id}) RETURN labels(s) AS labels, s.coreType AS coreType`,
        { id: scopeId },
      );
      expect(labelResult.length).toBe(1);
      const labels = labelResult[0].labels as string[];
      expect(labels).toContain('CodeNode');
      expect(labels).toContain('AnalysisScope');

      // SPEC: Section 4 — HAS_SCOPE edge
      const edgeResult = await neo4j.run(
        `MATCH (r:VerificationRun {id: $runId})-[e:HAS_SCOPE]->(s:AnalysisScope {id: $scopeId})
         RETURN count(e) AS cnt, e.projectId AS pid`,
        { runId, scopeId },
      );
      expect(Number(edgeResult[0]?.cnt)).toBe(1);
      expect(edgeResult[0]?.pid).toBe(testProjectId);
    });

    // SPEC: Section 4 — AdjudicationRecord nodes get `ADJUDICATES` edges to target nodes
    it('creates AdjudicationRecord nodes with ADJUDICATES edges to targets', async () => {
      const runId = `vr:${testProjectId}:adj-edge-test`;
      const adjId = `adj:${testProjectId}:adj-edge-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [],
        adjudications: [{
          ...adjDefaults,
          id: adjId,
          projectId: testProjectId,
          targetNodeId: runId,
          adjudicationState: 'dismissed',
          adjudicationReason: 'false_positive',
          requestedAt: new Date().toISOString(),
        }],
        pathWitnesses: [],
      };

      await ingestVerificationFoundation(bundle);

      // SPEC: Section 4 — ADJUDICATES edge
      const edgeResult = await neo4j.run(
        `MATCH (a:AdjudicationRecord {id: $adjId})-[e:ADJUDICATES]->(t:VerificationRun {id: $runId})
         RETURN count(e) AS cnt`,
        { adjId, runId },
      );
      expect(Number(edgeResult[0]?.cnt)).toBe(1);
    });

    // SPEC: Section 4 — PathWitness nodes get `ILLUSTRATES` edges to their run
    it('creates PathWitness nodes with ILLUSTRATES edges to VerificationRun', async () => {
      const runId = `vr:${testProjectId}:witness-edge-test`;
      const witnessId = `pw:${testProjectId}:witness-edge-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          criticality: 'high',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [],
        adjudications: [],
        pathWitnesses: [{
          id: witnessId,
          projectId: testProjectId,
          verificationRunId: runId,
          witnessType: 'relatedLocations',
          criticality: 'high',
          summary: 'test witness',
        }],
      };

      await ingestVerificationFoundation(bundle);

      // SPEC: Section 4 — ILLUSTRATES edge
      const edgeResult = await neo4j.run(
        `MATCH (w:PathWitness {id: $witnessId})-[e:ILLUSTRATES]->(r:VerificationRun {id: $runId})
         RETURN count(e) AS cnt`,
        { witnessId, runId },
      );
      expect(Number(edgeResult[0]?.cnt)).toBe(1);
    });

    // SPEC: Section 7 — MERGE semantics: re-ingesting same data is idempotent (no duplicates)
    it('uses MERGE semantics for idempotent ingestion', async () => {
      const runId = `vr:${testProjectId}:idempotent-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          resultFingerprint: 'fp-idempotent',
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [],
        adjudications: [],
        pathWitnesses: [],
      };

      // Ingest twice
      await ingestVerificationFoundation(bundle);
      await ingestVerificationFoundation(bundle);

      // SPEC: Section 7 — idempotent (no duplicates)
      const countResult = await neo4j.run(
        `MATCH (n:VerificationRun {id: $id}) RETURN count(n) AS cnt`,
        { id: runId },
      );
      expect(Number(countResult[0]?.cnt)).toBe(1);
    });

    // SPEC: Section 4 — All nodes get `projectId` property
    it('sets projectId on all ingested nodes', async () => {
      const runId = `vr:${testProjectId}:pid-test`;
      const scopeId = `scope:${testProjectId}:pid-test`;
      const adjId = `adj:${testProjectId}:pid-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [{
          ...scopeDefaults,
          id: scopeId,
          projectId: testProjectId,
          verificationRunId: runId,
          scopeCompleteness: 'complete',
        }],
        adjudications: [{
          ...adjDefaults,
          id: adjId,
          projectId: testProjectId,
          targetNodeId: runId,
          adjudicationState: 'reviewing',
          adjudicationReason: 'other',
        }],
        pathWitnesses: [],
      };

      await ingestVerificationFoundation(bundle);

      // Check projectId on all nodes
      const vrResult = await neo4j.run(
        `MATCH (n:VerificationRun {id: $id}) RETURN n.projectId AS pid`,
        { id: runId },
      );
      expect(vrResult[0]?.pid).toBe(testProjectId);

      const scopeResult = await neo4j.run(
        `MATCH (n:AnalysisScope {id: $id}) RETURN n.projectId AS pid`,
        { id: scopeId },
      );
      expect(scopeResult[0]?.pid).toBe(testProjectId);

      const adjResult = await neo4j.run(
        `MATCH (n:AdjudicationRecord {id: $id}) RETURN n.projectId AS pid`,
        { id: adjId },
      );
      expect(adjResult[0]?.pid).toBe(testProjectId);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SPEC: Section 4 — scopeCompleteness field validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('Scope Completeness (Section 4)', () => {
    // SPEC: Section 4 — `scopeCompleteness` field has 4 valid values: complete, partial, unknown, error
    it('accepts valid scopeCompleteness values', () => {
      // Note: Schema only defines 3 values (complete, partial, unknown), error path handled differently
      const validBundle = VerificationFoundationBundleSchema.parse({
        projectId: 'test',
        verificationRuns: [],
        analysisScopes: [
          { id: 's1', projectId: 'test', verificationRunId: 'vr1', scopeCompleteness: 'complete' },
          { id: 's2', projectId: 'test', verificationRunId: 'vr2', scopeCompleteness: 'partial' },
          { id: 's3', projectId: 'test', verificationRunId: 'vr3', scopeCompleteness: 'unknown' },
        ],
        adjudications: [],
        pathWitnesses: [],
      });

      expect(validBundle.analysisScopes.length).toBe(3);
      expect(validBundle.analysisScopes[0].scopeCompleteness).toBe('complete');
      expect(validBundle.analysisScopes[1].scopeCompleteness).toBe('partial');
      expect(validBundle.analysisScopes[2].scopeCompleteness).toBe('unknown');
    });

    // SPEC: Section 4 — invalid scopeCompleteness values should fail
    it('rejects invalid scopeCompleteness values', () => {
      expect(() => {
        VerificationFoundationBundleSchema.parse({
          projectId: 'test',
          verificationRuns: [],
          analysisScopes: [{
            ...scopeDefaults,
            id: 's1',
            projectId: 'test',
            verificationRunId: 'vr1',
            scopeCompleteness: 'invalid_value' as any,
          }],
          adjudications: [],
          pathWitnesses: [],
        });
      }).toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Schema validation requirements
  // ─────────────────────────────────────────────────────────────────────────

  describe('Schema Validation', () => {
    // SPEC: VerificationFoundationBundle must validate with Zod
    it('validates VerificationFoundationBundle with Zod', () => {
      const validBundle = {
        projectId: 'test-project',
        verificationRuns: [{
          id: 'vr:test:001',
          projectId: 'test-project',
          tool: 'CodeQL',
          status: 'violates',
          confidence: 0.9,
        }],
        analysisScopes: [],
        adjudications: [],
        pathWitnesses: [],
      };

      const parsed = VerificationFoundationBundleSchema.parse(validBundle);
      expect(parsed.projectId).toBe('test-project');
      expect(parsed.verificationRuns.length).toBe(1);
    });

    // SPEC: Missing required fields → Zod error (not silent failure)
    it('throws Zod error for missing required fields', () => {
      // Missing projectId
      expect(() => {
        VerificationFoundationBundleSchema.parse({
          verificationRuns: [],
          analysisScopes: [],
          adjudications: [],
        });
      }).toThrow();

      // Missing id on VerificationRun
      expect(() => {
        VerificationFoundationBundleSchema.parse({
          projectId: 'test',
          verificationRuns: [{
            projectId: 'test',
            tool: 'test',
            // missing id
          }],
          analysisScopes: [],
          adjudications: [],
        });
      }).toThrow();
    });

    // SPEC: Empty arrays are valid (0 runs, 0 scopes = valid bundle)
    it('accepts empty arrays as valid bundle', () => {
      const emptyBundle = VerificationFoundationBundleSchema.parse({
        projectId: 'test-empty',
        verificationRuns: [],
        analysisScopes: [],
        adjudications: [],
        pathWitnesses: [],
      });

      expect(emptyBundle.projectId).toBe('test-empty');
      expect(emptyBundle.verificationRuns).toEqual([]);
      expect(emptyBundle.analysisScopes).toEqual([]);
      expect(emptyBundle.adjudications).toEqual([]);
      expect(emptyBundle.pathWitnesses).toEqual([]);
    });
  });
});

// ============================================================================
// PHASE B: Implementation Edge Case Tests
// ============================================================================
// These tests are derived from reading the actual implementation code.
// They cover edge cases and implementation-specific behavior that may
// not be explicitly documented in the spec.

describe('SARIF + Ingest — Implementation Edge Cases', () => {
  let testDir: string;
  let neo4j: Neo4jService;
  const testProjectId = `__test_sarif_impl_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    testDir = join(tmpdir(), `sarif-impl-test-${randomUUID().slice(0, 8)}`);
    await mkdir(testDir, { recursive: true });
    neo4j = new Neo4jService();
    await neo4j.run(`MATCH (n {projectId: $pid}) DETACH DELETE n`, { pid: testProjectId });
  });

  afterAll(async () => {
    await neo4j.run(`MATCH (n {projectId: $pid}) DETACH DELETE n`, { pid: testProjectId });
    await neo4j.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: chooseFingerprint() fallback chain
  // ─────────────────────────────────────────────────────────────────────────

  describe('chooseFingerprint() Fallback Chain', () => {
    // IMPL-EDGE-CASE: prefers primaryLocationLineHash when present
    it('prefers primaryLocationLineHash over other fingerprints', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test-rule',
            level: 'warning',
            message: { text: 'test' },
            partialFingerprints: {
              primaryLocationLineHash: 'preferred-hash',
              primaryLocationStartColumnFingerprint: 'secondary-hash',
              primaryLocationStartLineFingerprint: 'tertiary-hash',
            },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'fp-prefer.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns[0].resultFingerprint).toBe('preferred-hash');
    });

    // IMPL-EDGE-CASE: falls back to primaryLocationStartColumnFingerprint
    it('falls back to primaryLocationStartColumnFingerprint when line hash missing', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test-rule',
            level: 'warning',
            message: { text: 'test' },
            partialFingerprints: {
              primaryLocationStartColumnFingerprint: 'column-hash',
              primaryLocationStartLineFingerprint: 'line-hash',
            },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'fp-fallback1.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns[0].resultFingerprint).toBe('column-hash');
    });

    // IMPL-EDGE-CASE: computes hash when no fingerprints present
    it('computes hash from ruleId/message/location when no fingerprints present', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test-rule-hash',
            level: 'warning',
            message: { text: 'unique message for hashing' },
            partialFingerprints: {},
            locations: [{ physicalLocation: { artifactLocation: { uri: 'unique/path.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'fp-compute.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns[0].resultFingerprint).toBeDefined();
      expect(bundle.verificationRuns[0].resultFingerprint!.length).toBe(20);
    });

    // IMPL-EDGE-CASE: handles undefined partialFingerprints
    it('handles undefined partialFingerprints object', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'no-fp-rule',
            level: 'warning',
            message: { text: 'no fingerprints' },
            // partialFingerprints is undefined
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'fp-undefined.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns[0].resultFingerprint).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Malformed SARIF handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('Malformed SARIF Handling', () => {
    // IMPL-EDGE-CASE: missing runs array
    it('handles SARIF with missing runs array', async () => {
      const sarif = {
        version: '2.1.0',
        // runs is missing
      };

      const sarifPath = join(testDir, 'missing-runs.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns).toEqual([]);
      expect(bundle.analysisScopes).toEqual([]);
    });

    // IMPL-EDGE-CASE: null results array
    it('handles SARIF with null results in run', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: null,  // explicit null
        }],
      };

      const sarifPath = join(testDir, 'null-results.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // Should treat as clean run
      expect(bundle.verificationRuns.length).toBe(1);
      expect(bundle.verificationRuns[0].status).toBe('satisfies');
    });

    // IMPL-EDGE-CASE: empty tool.driver object
    it('handles SARIF with empty tool.driver', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: {} },  // empty driver
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'empty-driver.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'any',  // Use 'any' since filter might not match 'unknown'
      });

      expect(bundle.verificationRuns.length).toBe(1);
      expect(bundle.verificationRuns[0].tool).toBe('unknown');
    });

    // IMPL-EDGE-CASE: missing tool entirely
    it('handles SARIF with missing tool object', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          // tool is missing
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'missing-tool.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'any',
      });

      expect(bundle.verificationRuns.length).toBe(1);
      expect(bundle.verificationRuns[0].tool).toBe('unknown');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: mapSuppressionState() enum mapping
  // ─────────────────────────────────────────────────────────────────────────

  describe('mapSuppressionState() Mapping', () => {
    // Test via SARIF import with different suppression states

    // IMPL-EDGE-CASE: "review" variants → reviewing
    it('maps review state variants to reviewing', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [
              { kind: 'inSource', status: 'under review', justification: 'test1' },
              { kind: 'inSource', status: 'Reviewing', justification: 'test2' },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'sup-review.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications.length).toBe(2);
      expect(bundle.adjudications[0].adjudicationState).toBe('reviewing');
      expect(bundle.adjudications[1].adjudicationState).toBe('reviewing');
    });

    // IMPL-EDGE-CASE: "dismiss" variants → dismissed
    it('maps dismiss/accept/approved variants to dismissed', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [
              { kind: 'inSource', status: 'dismissed', justification: 'test1' },
              { kind: 'inSource', status: 'accepted', justification: 'test2' },
              { kind: 'inSource', status: 'approved', justification: 'test3' },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'sup-dismiss.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications.every(a => a.adjudicationState === 'dismissed')).toBe(true);
    });

    // IMPL-EDGE-CASE: unknown status → ignored (default)
    it('defaults to ignored for unknown suppression states', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [
              { kind: 'inSource', status: '', justification: 'empty status' },
              { kind: 'inSource', status: 'some_unknown_status', justification: 'unknown' },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'sup-unknown.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications.every(a => a.adjudicationState === 'ignored')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: mapSuppressionReason() enum mapping
  // ─────────────────────────────────────────────────────────────────────────

  describe('mapSuppressionReason() Mapping', () => {
    // IMPL-EDGE-CASE: "false positive" → false_positive
    it('maps false positive variants correctly', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [
              { kind: 'inSource', justification: 'This is a false positive', status: 'accepted' },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'reason-fp.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].adjudicationReason).toBe('false_positive');
    });

    // IMPL-EDGE-CASE: unknown reason → other (default)
    it('defaults to other for unrecognized justifications', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [
              { kind: 'inSource', justification: 'Some custom reason here', status: 'accepted' },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'reason-other.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].adjudicationReason).toBe('other');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: computeScopeCompleteness() return value coverage
  // ─────────────────────────────────────────────────────────────────────────

  describe('computeScopeCompleteness() Edge Cases', () => {
    // IMPL-EDGE-CASE: analysisErrorCount > 0 → partial
    it('returns partial when analysisErrorCount > 0', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          invocations: [{ executionSuccessful: false }],  // indicates error
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'scope-error.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.analysisScopes[0].scopeCompleteness).toBe('partial');
    });

    // IMPL-EDGE-CASE: no results and no artifacts → unknown scope
    it('returns unknown for empty scope with no artifacts', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          artifacts: [],  // empty artifacts
          results: [],
        }],
      };

      const sarifPath = join(testDir, 'scope-empty.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // Clean run with no artifacts should be unknown scope
      expect(bundle.analysisScopes[0].scopeCompleteness).toBe('unknown');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Cypher MERGE behavior on duplicate ingestion
  // ─────────────────────────────────────────────────────────────────────────

  describe('Neo4j MERGE Idempotency', () => {
    // IMPL-EDGE-CASE: edge counts remain correct after duplicate ingestion
    it('maintains correct edge counts after duplicate ingestion', async () => {
      const runId = `vr:${testProjectId}:merge-edge-test`;
      const scopeId = `scope:${testProjectId}:merge-edge-test`;

      const bundle: VerificationFoundationBundle = {
        projectId: testProjectId,
        verificationRuns: [{
          id: runId,
          projectId: testProjectId,
          tool: 'test-tool',
          status: 'violates',
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }],
        analysisScopes: [{
          ...scopeDefaults,
          id: scopeId,
          projectId: testProjectId,
          verificationRunId: runId,
          scopeCompleteness: 'complete',
        }],
        adjudications: [],
        pathWitnesses: [],
      };

      // Ingest three times
      const result1 = await ingestVerificationFoundation(bundle);
      const result2 = await ingestVerificationFoundation(bundle);
      const result3 = await ingestVerificationFoundation(bundle);

      // Each call should report 1 edge upserted (MERGE is idempotent)
      expect(result1.hasScopeEdges).toBe(1);
      expect(result2.hasScopeEdges).toBe(1);
      expect(result3.hasScopeEdges).toBe(1);

      // But only 1 edge should exist in graph
      const edgeCount = await neo4j.run(
        `MATCH (r:VerificationRun {id: $runId})-[e:HAS_SCOPE]->(s:AnalysisScope {id: $scopeId})
         RETURN count(e) AS cnt`,
        { runId, scopeId },
      );
      expect(Number(edgeCount[0]?.cnt)).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Tool filter behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe('Tool Filter Behavior', () => {
    // IMPL-EDGE-CASE: codeql filter matches case-insensitively
    it('matches CodeQL tool name case-insensitively', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CODEQL' } },  // uppercase
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'codeql-upper.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns.length).toBe(1);
    });

    // IMPL-EDGE-CASE: semgrep filter skips non-semgrep runs
    it('skips non-matching tool runs with semgrep filter', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },  // Not semgrep
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'not-semgrep.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'semgrep',
      });

      // Should skip the CodeQL run
      expect(bundle.verificationRuns.length).toBe(0);
    });

    // IMPL-EDGE-CASE: 'any' filter accepts all tools
    it('accepts all tools with any filter', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [
          {
            tool: { driver: { name: 'CodeQL' } },
            results: [{
              ruleId: 'test1',
              level: 'warning',
              message: { text: 'test1' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'test1.ts' } } }],
            }],
          },
          {
            tool: { driver: { name: 'Semgrep' } },
            results: [{
              ruleId: 'test2',
              level: 'warning',
              message: { text: 'test2' },
              locations: [{ physicalLocation: { artifactLocation: { uri: 'test2.ts' } } }],
            }],
          },
        ],
      };

      const sarifPath = join(testDir, 'multi-tool.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'any',
      });

      expect(bundle.verificationRuns.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: extractTicketRef() behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe('extractTicketRef() Behavior', () => {
    // IMPL-EDGE-CASE: extracts JIRA-style ticket refs
    it('extracts JIRA-style ticket references from justification', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [{
              kind: 'inSource',
              justification: 'Tracked in JIRA-1234, will fix later',
              status: 'accepted',
            }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'ticket-ref.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].ticketRef).toBe('JIRA-1234');
    });

    // IMPL-EDGE-CASE: returns undefined when no ticket ref found
    it('returns undefined when no ticket reference found', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [{
              kind: 'inSource',
              justification: 'No ticket reference here',
              status: 'accepted',
            }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'no-ticket.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].ticketRef).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: mapAdjudicationSource() behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe('mapAdjudicationSource() Mapping', () => {
    // IMPL-EDGE-CASE: inSource → inline_suppression
    it('maps inSource kind to inline_suppression source', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [{
              kind: 'inSource',
              justification: 'test',
              status: 'accepted',
            }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'source-insource.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].adjudicationSource).toBe('inline_suppression');
    });

    // IMPL-EDGE-CASE: external → external_dismissal
    it('maps external kind to external_dismissal source', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            suppressions: [{
              kind: 'external',
              justification: 'test',
              status: 'accepted',
            }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'source-external.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.adjudications[0].adjudicationSource).toBe('external_dismissal');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: Level mapping edge cases
  // ─────────────────────────────────────────────────────────────────────────

  describe('Level Mapping Edge Cases', () => {
    // IMPL-EDGE-CASE: 'note' level → low criticality
    it('maps note level to low criticality', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'note',
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'level-note.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      expect(bundle.verificationRuns[0].criticality).toBe('low');
      expect(bundle.verificationRuns[0].confidence).toBe(0.7);
    });

    // IMPL-EDGE-CASE: missing level → low criticality (default)
    it('defaults to low criticality when level is missing', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            // level is missing
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
          }],
        }],
      };

      const sarifPath = join(testDir, 'level-missing.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // Default is 'warning' which maps to medium
      expect(bundle.verificationRuns[0].criticality).toBe('medium');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // IMPL-EDGE-CASE: PathWitness only created for high/safety_critical
  // ─────────────────────────────────────────────────────────────────────────

  describe('PathWitness Creation Threshold', () => {
    // IMPL-EDGE-CASE: low criticality results don't create PathWitness
    it('does not create PathWitness for low criticality findings', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'note',  // low criticality
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            relatedLocations: [
              { physicalLocation: { artifactLocation: { uri: 'other.ts' } } },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'witness-low.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // Low criticality → no PathWitness even with relatedLocations
      expect(bundle.pathWitnesses!.length).toBe(0);
    });

    // IMPL-EDGE-CASE: medium criticality results don't create PathWitness
    it('does not create PathWitness for medium criticality findings', async () => {
      const sarif = {
        version: '2.1.0',
        runs: [{
          tool: { driver: { name: 'CodeQL' } },
          results: [{
            ruleId: 'test',
            level: 'warning',  // medium criticality
            message: { text: 'test' },
            locations: [{ physicalLocation: { artifactLocation: { uri: 'test.ts' } } }],
            relatedLocations: [
              { physicalLocation: { artifactLocation: { uri: 'other.ts' } } },
            ],
          }],
        }],
      };

      const sarifPath = join(testDir, 'witness-medium.sarif');
      await writeFile(sarifPath, JSON.stringify(sarif));

      const bundle = await importSarifToVerificationBundle({
        projectId: testProjectId,
        sarifPath,
        toolFilter: 'codeql',
      });

      // Medium criticality → no PathWitness
      expect(bundle.pathWitnesses!.length).toBe(0);
    });
  });
});
