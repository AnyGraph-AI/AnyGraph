/**
 * [AUD-TC-04-L1-02] graph-integrity-snapshot.ts — Spec-Derived Tests
 *
 * Spec: GRAPH_INTEGRITY_SNAPSHOT.md §S2 "Snapshot Job" — query contract Q2/Q6/Q7;
 *       §S5 "Graph-Native Snapshot History" — ingest into IntegritySnapshot nodes
 *
 * Behaviors tested via contract verification:
 * (1) JSONL row writing contract (mkdirSync + appendFileSync semantics)
 * (2) per-project query contracts (Q2/Q2_EDGES pattern compliance)
 * (3) SnapshotRow fields (8 required fields per §S1)
 * (4) ingestLatestSnapshotRowsToGraph() call contract
 * (5) append-only semantics (appendFileSync vs writeFileSync)
 * (6) output filename format (YYYY-MM-DD.jsonl)
 * (7) numeric field type enforcement
 *
 * Note: Source module runs main() immediately on import. Tests verify contracts
 * that the module is bound to implement per spec, without dynamic execution.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load and parse the actual source file to verify structural contracts
const SOURCE_PATH = join(__dirname, '../graph-integrity-snapshot.ts');
let sourceCode: string;
try {
  sourceCode = readFileSync(SOURCE_PATH, 'utf-8');
} catch {
  sourceCode = ''; // Will cause tests to fail appropriately
}

// SnapshotRow interface from spec
interface SnapshotRow {
  timestamp: string;
  graphEpoch: string;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  unresolvedLocalCount: number;
  invariantViolationCount: number;
  duplicateSourceSuspicionCount: number;
}

// Query contract patterns from QUERY_CONTRACT.md
const Q2_NODE_PATTERN = /MATCH.*\(n\).*WHERE.*n\.projectId.*RETURN.*projectId.*nodeCount/s;
const Q2_EDGES_PATTERN = /MATCH.*\(\)-\[r\]->\(\).*WHERE.*r\.projectId.*RETURN.*projectId.*edgeCount/s;
const Q6_PATTERN = /UnresolvedReference.*local-module-not-found.*unresolvedLocalCount/s;

describe('[AUD-TC-04-L1-02] graph-integrity-snapshot.ts', () => {
  describe('JSONL row writing contract', () => {
    it('(1) uses mkdirSync with recursive option for directory creation', () => {
      // Contract: source must call mkdirSync with { recursive: true }
      expect(sourceCode).toContain('mkdirSync');
      expect(sourceCode).toContain('recursive: true');
    });

    it('(2) uses appendFileSync for append-only JSONL writing', () => {
      // Contract: must use appendFileSync (not writeFileSync) for row writing
      expect(sourceCode).toContain('appendFileSync');
      // Verify it's used with utf8 encoding
      expect(sourceCode).toMatch(/appendFileSync\([^)]+,\s*[^,]+,\s*['"]utf8['"]\)/);
    });
  });

  describe('query contract compliance', () => {
    it('(3) Q2 node count query includes projectId filter and count aggregation', () => {
      // Contract from QUERY_CONTRACT.md: Q2 queries nodes grouped by projectId
      expect(sourceCode).toMatch(Q2_NODE_PATTERN);
    });

    it('(4) Q2_EDGES edge count query includes projectId filter and count aggregation', () => {
      // Contract: separate edge query with same pattern
      expect(sourceCode).toMatch(Q2_EDGES_PATTERN);
    });

    it('(5) Q6 unresolved local query checks for local-module-not-found reason', () => {
      // Contract: Q6 checks UnresolvedReference with specific reason
      expect(sourceCode).toMatch(Q6_PATTERN);
    });

    it('(6) Q7 invariant violation query uses AuditCheck nodes', () => {
      // Contract: Q7 queries AuditCheck nodes for latest run
      expect(sourceCode).toContain(':AuditCheck');
      expect(sourceCode).toContain('invariantViolationCount');
    });
  });

  describe('SnapshotRow field completeness', () => {
    it('(7) SnapshotRow interface contains all 8 required fields per §S1', () => {
      // Contract: §S1 defines the schema fields
      const REQUIRED_FIELDS = [
        'timestamp',
        'graphEpoch',
        'projectId',
        'nodeCount',
        'edgeCount',
        'unresolvedLocalCount',
        'invariantViolationCount',
        'duplicateSourceSuspicionCount',
      ];

      // Verify all fields exist in source SnapshotRow definition
      for (const field of REQUIRED_FIELDS) {
        expect(sourceCode).toContain(`${field}:`);
      }
    });

    it('(8) numeric fields typed as number in interface', () => {
      // Contract: numeric fields must be numbers, not strings
      const numericFields = [
        'nodeCount',
        'edgeCount',
        'unresolvedLocalCount',
        'invariantViolationCount',
        'duplicateSourceSuspicionCount',
      ];

      // Check that interface defines these as number type
      for (const field of numericFields) {
        expect(sourceCode).toMatch(new RegExp(`${field}:\\s*number`));
      }
    });

    it('(9) SnapshotRow object construction includes all fields', () => {
      // Verify actual object creation includes all fields
      const rowConstruction = sourceCode.match(/\{[\s\S]*?timestamp[\s\S]*?duplicateSourceSuspicionCount[\s\S]*?\}/);
      expect(rowConstruction).toBeTruthy();
    });
  });

  describe('graph ingest integration (§S5)', () => {
    it('(10) imports ingestLatestSnapshotRowsToGraph from integrity-snapshot-graph-ingest', () => {
      // Contract: §S5 requires graph-native snapshot history via ingest call
      expect(sourceCode).toContain('ingestLatestSnapshotRowsToGraph');
      expect(sourceCode).toContain('integrity-snapshot-graph-ingest');
    });

    it('(11) calls ingestLatestSnapshotRowsToGraph with snapshotDir and neo4j params', () => {
      // Contract: ingest function called with required parameters
      expect(sourceCode).toMatch(/ingestLatestSnapshotRowsToGraph\(\s*\{\s*snapshotDir/);
    });
  });

  describe('append-only semantics', () => {
    it('(12) uses appendFileSync not writeFileSync for row output', () => {
      // Contract: append-only semantics for JSONL files
      expect(sourceCode).toContain('appendFileSync');
      
      // Should not use writeFileSync for row writing
      // (writeFileSync would overwrite existing content)
      const writeFileSyncUsage = sourceCode.match(/writeFileSync.*\.jsonl/);
      expect(writeFileSyncUsage).toBeNull();
    });
  });

  describe('output filename contract', () => {
    it('(13) output filename uses YYYY-MM-DD.jsonl date format', () => {
      // Contract: timestamp.slice(0, 10) extracts YYYY-MM-DD
      expect(sourceCode).toMatch(/timestamp\.slice\(0,\s*10\)/);
      expect(sourceCode).toContain('.jsonl');
    });

    it('(14) SNAPSHOT_DIR points to artifacts/integrity-snapshots', () => {
      expect(sourceCode).toContain("'artifacts'");
      expect(sourceCode).toContain("'integrity-snapshots'");
    });
  });

  describe('error handling contract', () => {
    it('(15) checks INTEGRITY_SNAPSHOT_GRAPH_INGEST_REQUIRED env var', () => {
      // Contract: env var controls error vs warning on ingest failure
      expect(sourceCode).toContain('INTEGRITY_SNAPSHOT_GRAPH_INGEST_REQUIRED');
    });

    it('(16) throws error when ingest required and fails', () => {
      expect(sourceCode).toMatch(/throw new Error.*graph ingest failed/i);
    });

    it('(17) warns but continues when ingest optional and fails', () => {
      expect(sourceCode).toContain('console.warn');
      expect(sourceCode).toContain('INTEGRITY_SNAPSHOT_GRAPH_INGEST_WARN');
    });
  });
});
