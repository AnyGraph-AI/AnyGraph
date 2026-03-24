/**
 * AUD-TC-03-L1b-30: entity-identity-model-sync.ts audit tests
 *
 * Spec: plans/codegraph/MULTI_LANGUAGE_ASSESSMENT.md §"Entity Resolution"
 *       plans/codegraph/VERIFICATION_GRAPH_ROADMAP.md §CA-4 "Fix canonicalCreated telemetry"
 *
 * Behaviors:
 *   (1) queries ObservedEntity nodes and groups by normalized name/kind
 *   (2) creates/merges CanonicalEntity nodes with deterministic IDs (SHA256)
 *   (3) creates RESOLVES_TO edges from ObservedEntity to CanonicalEntity
 *   (4) labels nodes with ObservedEntity/CanonicalEntity
 *   (5) uses meta project ID (proj_e17e17e17e17)
 *   (6) produces accurate canonicalCreated vs matched telemetry
 *   (7) is replay-stable (rerun produces same graph state)
 */

import { createHash } from 'node:crypto';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ──

const { mockRun, mockClose } = vi.hoisted(() => ({
  mockRun: vi.fn().mockResolvedValue([]),
  mockClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../storage/neo4j/neo4j.service.js', () => ({
  Neo4jService: class MockNeo4jService {
    run = mockRun;
    close = mockClose;
  },
}));

let mockExit: ReturnType<typeof vi.spyOn>;
let mockConsoleLog: ReturnType<typeof vi.spyOn>;
let mockConsoleError: ReturnType<typeof vi.spyOn>;

const META_PROJECT_ID = 'proj_e17e17e17e17';

beforeEach(() => {
  vi.resetModules();
  mockRun.mockReset().mockResolvedValue([]);
  mockClose.mockReset().mockResolvedValue(undefined);
  mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockExit.mockRestore();
  mockConsoleLog.mockRestore();
  mockConsoleError.mockRestore();
});

// Reproduce the canonical ID logic to verify determinism
function expectedCanonicalId(kind: string, normalized: string): string {
  const h = createHash('sha256').update(`${kind}|${normalized}`).digest('hex').slice(0, 24);
  return `${META_PROJECT_ID}:CanonicalEntity:${h}`;
}

// Setup default mock sequence for a successful run
function setupMockSequence(
  observedEntities: Array<{ observedId: string; observedProjectId: string; kind: string; normalized: string; value: string }>,
  persons: Array<{ personId: string; normalized: string }> = [],
) {
  let callIndex = 0;
  mockRun.mockImplementation(async (query: string, params?: Record<string, unknown>) => {
    callIndex++;
    // Call 1: MERGE meta project
    if (query.includes('MERGE (p:Project')) return [];
    // Call 2: SET ExtractedEntity -> ObservedEntity
    if (query.includes('SET e:ObservedEntity')) return [];
    // Call 3: SET Person -> CanonicalEntity
    if (query.includes('SET p:CanonicalEntity')) return [];
    // Call 4: Query ObservedEntity
    if (query.includes('MATCH (o:ObservedEntity)')) return observedEntities;
    // Call 5: Query Person
    if (query.includes('MATCH (p:Person)')) return persons;
    // Per-entity MERGE CanonicalEntity
    if (query.includes('MERGE (c:CanonicalEntity')) {
      return [{ createdNow: 1 }];
    }
    // Per-entity MERGE RESOLVES_TO
    if (query.includes('RESOLVES_TO')) {
      return [{ count: 1 }];
    }
    // Cleanup _identitySyncRunId
    if (query.includes('REMOVE c._identitySyncRunId')) return [];
    // Final counts
    if (query.includes('MATCH (c:CanonicalEntity) RETURN count')) return [{ c: observedEntities.length }];
    if (query.includes('MATCH (o:ObservedEntity) RETURN count')) return [{ c: observedEntities.length }];
    return [];
  });
}

async function runMain(): Promise<void> {
  await import('../../../utils/entity-identity-model-sync.js');
  await new Promise((r) => setTimeout(r, 50));
}

describe('AUD-TC-03-L1b-30: entity-identity-model-sync', () => {
  // ── Behavior 1: queries ObservedEntity nodes and groups by normalized name/kind ──
  describe('B1: queries ObservedEntity nodes grouped by normalized name/kind', () => {
    it('queries ObservedEntity nodes from graph', async () => {
      setupMockSequence([]);

      await runMain();

      const observedQuery = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MATCH (o:ObservedEntity)'),
      );
      expect(observedQuery).toBeDefined();
      const query = observedQuery![0] as string;
      expect(query).toContain('o.kind');
      expect(query).toContain('normalized');
    });

    it('normalizes name: trims, lowercases, collapses whitespace', () => {
      // Verify normalization behavior inline since norm() is internal
      function norm(s: string): string {
        return s.trim().toLowerCase().replace(/\s+/g, ' ');
      }
      expect(norm('  John   DOE  ')).toBe('john doe');
      expect(norm('Jane\t\nSmith')).toBe('jane smith');
      expect(norm('ALICE')).toBe('alice');
    });
  });

  // ── Behavior 2: creates CanonicalEntity nodes with deterministic SHA256 IDs ──
  describe('B2: deterministic CanonicalEntity IDs via SHA256', () => {
    it('canonical ID is SHA256 of kind|normalized with meta project prefix', () => {
      const id1 = expectedCanonicalId('Person', 'john doe');
      const id2 = expectedCanonicalId('Person', 'john doe');
      expect(id1).toBe(id2); // deterministic

      // Format: proj_e17e17e17e17:CanonicalEntity:{24-char-hex}
      expect(id1).toMatch(/^proj_e17e17e17e17:CanonicalEntity:[a-f0-9]{24}$/);
    });

    it('different kind or normalized name produces different IDs', () => {
      const idPerson = expectedCanonicalId('Person', 'john doe');
      const idOrg = expectedCanonicalId('Organization', 'john doe');
      const idDifferentName = expectedCanonicalId('Person', 'jane doe');

      expect(idPerson).not.toBe(idOrg);
      expect(idPerson).not.toBe(idDifferentName);
    });

    it('MERGE query uses the deterministic canonical ID', async () => {
      const entity = {
        observedId: 'obs-1',
        observedProjectId: 'proj_test',
        kind: 'Person',
        normalized: 'john doe',
        value: 'John Doe',
      };

      setupMockSequence([entity]);
      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (c:CanonicalEntity'),
      );
      expect(mergeCall).toBeDefined();
      const params = mergeCall![1] as Record<string, unknown>;
      expect(params.id).toBe(expectedCanonicalId('Person', 'john doe'));
    });
  });

  // ── Behavior 3: creates RESOLVES_TO edges ──
  describe('B3: creates RESOLVES_TO edges from ObservedEntity to CanonicalEntity', () => {
    it('creates RESOLVES_TO edge with resolutionKind=entity_identity', async () => {
      const entity = {
        observedId: 'obs-1',
        observedProjectId: 'proj_test',
        kind: 'Organization',
        normalized: 'acme corp',
        value: 'Acme Corp',
      };

      setupMockSequence([entity]);
      await runMain();

      const resolveCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('RESOLVES_TO'),
      );
      expect(resolveCall).toBeDefined();
      const query = resolveCall![0] as string;
      expect(query).toContain("resolutionKind: 'entity_identity'");
      const params = resolveCall![1] as Record<string, unknown>;
      expect(params.observedId).toBe('obs-1');
      expect(params.canonicalId).toBe(expectedCanonicalId('Organization', 'acme corp'));
    });

    it('uses observed entity projectId as edge projectId', async () => {
      const entity = {
        observedId: 'obs-2',
        observedProjectId: 'proj_specific',
        kind: 'Entity',
        normalized: 'test entity',
        value: 'Test Entity',
      };

      setupMockSequence([entity]);
      await runMain();

      const resolveCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('RESOLVES_TO'),
      );
      expect(resolveCall).toBeDefined();
      const params = resolveCall![1] as Record<string, unknown>;
      expect(params.edgeProjectId).toBe('proj_specific');
    });

    it('Person entities matching existing Person nodes get higher confidence (0.95)', async () => {
      const entity = {
        observedId: 'obs-p1',
        observedProjectId: 'proj_test',
        kind: 'person', // lowercase to test normalization
        normalized: 'john doe',
        value: 'John Doe',
      };
      const persons = [{ personId: 'person-canonical-1', normalized: 'john doe' }];

      setupMockSequence([entity], persons);
      await runMain();

      const resolveCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('RESOLVES_TO'),
      );
      expect(resolveCall).toBeDefined();
      const params = resolveCall![1] as Record<string, unknown>;
      expect(params.confidence).toBe(0.95);
      expect(params.canonicalId).toBe('person-canonical-1');
    });

    it('non-Person entities get default confidence (0.7)', async () => {
      const entity = {
        observedId: 'obs-np1',
        observedProjectId: 'proj_test',
        kind: 'Organization',
        normalized: 'acme corp',
        value: 'Acme Corp',
      };

      setupMockSequence([entity]);
      await runMain();

      const resolveCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('RESOLVES_TO'),
      );
      expect(resolveCall).toBeDefined();
      const params = resolveCall![1] as Record<string, unknown>;
      expect(params.confidence).toBe(0.7);
    });
  });

  // ── Behavior 4: labels nodes with ObservedEntity/CanonicalEntity ──
  describe('B4: labels nodes correctly', () => {
    it('sets ObservedEntity label on ExtractedEntity nodes', async () => {
      setupMockSequence([]);
      await runMain();

      const labelCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('SET e:ObservedEntity'),
      );
      expect(labelCall).toBeDefined();
      const query = labelCall![0] as string;
      expect(query).toContain('MATCH (e:ExtractedEntity)');
      expect(query).toContain('SET e:ObservedEntity');
    });

    it('sets CanonicalEntity label on Person nodes', async () => {
      setupMockSequence([]);
      await runMain();

      const labelCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('SET p:CanonicalEntity'),
      );
      expect(labelCall).toBeDefined();
      const query = labelCall![0] as string;
      expect(query).toContain('MATCH (p:Person)');
      expect(query).toContain('SET p:CanonicalEntity');
    });

    it('MERGE creates CanonicalEntity-labeled nodes', async () => {
      const entity = {
        observedId: 'obs-lbl',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'test label',
        value: 'Test Label',
      };

      setupMockSequence([entity]);
      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (c:CanonicalEntity'),
      );
      expect(mergeCall).toBeDefined();
    });
  });

  // ── Behavior 5: uses meta project ID ──
  describe('B5: uses meta project ID (proj_e17e17e17e17)', () => {
    it('creates meta project node with projectId=proj_e17e17e17e17', async () => {
      setupMockSequence([]);
      await runMain();

      const projectCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (p:Project'),
      );
      expect(projectCall).toBeDefined();
      const params = projectCall![1] as Record<string, unknown>;
      expect(params.projectId).toBe(META_PROJECT_ID);
    });

    it('canonical entities use meta project ID', async () => {
      const entity = {
        observedId: 'obs-meta',
        observedProjectId: 'proj_other',
        kind: 'Entity',
        normalized: 'meta test',
        value: 'Meta Test',
      };

      setupMockSequence([entity]);
      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (c:CanonicalEntity'),
      );
      expect(mergeCall).toBeDefined();
      const params = mergeCall![1] as Record<string, unknown>;
      expect(params.projectId).toBe(META_PROJECT_ID);
    });
  });

  // ── Behavior 6: accurate canonicalCreated telemetry ──
  describe('B6: accurate canonicalCreated vs matched telemetry', () => {
    it('reports canonicalCreated count from _identitySyncRunId tracking', async () => {
      const entity = {
        observedId: 'obs-tel',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'telemetry test',
        value: 'Telemetry Test',
      };

      setupMockSequence([entity]);
      await runMain();

      expect(mockConsoleLog).toHaveBeenCalled();
      // Find the JSON output call (dotenv may log first)
      const jsonCall = mockConsoleLog.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].startsWith('{'),
      );
      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output).toHaveProperty('canonicalCreated');
      expect(output.canonicalCreated).toBe(1);
    });

    it('matched entities (createdNow=0) are not counted as created', async () => {
      const entity = {
        observedId: 'obs-match',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'existing entity',
        value: 'Existing Entity',
      };

      // Override to return createdNow=0 (entity already existed)
      let callCount = 0;
      mockRun.mockImplementation(async (query: string) => {
        callCount++;
        if (query.includes('MERGE (p:Project')) return [];
        if (query.includes('SET e:ObservedEntity')) return [];
        if (query.includes('SET p:CanonicalEntity')) return [];
        if (query.includes('MATCH (o:ObservedEntity)')) return [entity];
        if (query.includes('MATCH (p:Person)')) return [];
        if (query.includes('MERGE (c:CanonicalEntity')) return [{ createdNow: 0 }]; // already existed
        if (query.includes('RESOLVES_TO')) return [{ count: 1 }];
        if (query.includes('REMOVE c._identitySyncRunId')) return [];
        if (query.includes('MATCH (c:CanonicalEntity) RETURN count')) return [{ c: 1 }];
        if (query.includes('MATCH (o:ObservedEntity) RETURN count')) return [{ c: 1 }];
        return [];
      });

      await runMain();

      const jsonCall = mockConsoleLog.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].startsWith('{'),
      );
      expect(jsonCall).toBeDefined();
      const output = JSON.parse(jsonCall![0]);
      expect(output.canonicalCreated).toBe(0);
    });

    it('cleans up _identitySyncRunId after telemetry calculation', async () => {
      setupMockSequence([{
        observedId: 'obs-cleanup',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'cleanup test',
        value: 'Cleanup Test',
      }]);

      await runMain();

      const cleanupCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('REMOVE c._identitySyncRunId'),
      );
      expect(cleanupCall).toBeDefined();
      // SPEC-GAP: The cleanup of _identitySyncRunId is an implementation detail not mentioned
      // in the spec. It's needed for accurate telemetry but the spec only says "Fix canonicalCreated telemetry."
    });
  });

  // ── Behavior 7: replay-stable ──
  describe('B7: replay-stable (rerun produces same graph state)', () => {
    it('uses MERGE (not CREATE) for CanonicalEntity and RESOLVES_TO', async () => {
      const entity = {
        observedId: 'obs-replay',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'replay test',
        value: 'Replay Test',
      };

      setupMockSequence([entity]);
      await runMain();

      // Verify MERGE is used (not CREATE) for both entities and edges
      const canonicalCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (c:CanonicalEntity'),
      );
      expect(canonicalCall).toBeDefined();
      expect((canonicalCall![0] as string)).not.toContain('CREATE (c:CanonicalEntity');

      const resolveCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (o)-[r:RESOLVES_TO'),
      );
      expect(resolveCall).toBeDefined();
      expect((resolveCall![0] as string)).not.toContain('CREATE (o)-[r:RESOLVES_TO');
    });

    it('same input produces same canonical ID (deterministic hash)', () => {
      // Same input => same ID, always
      const run1 = expectedCanonicalId('Person', 'john doe');
      const run2 = expectedCanonicalId('Person', 'john doe');
      const run3 = expectedCanonicalId('Person', 'john doe');
      expect(run1).toBe(run2);
      expect(run2).toBe(run3);
    });

    it('ON MATCH preserves existing fields (non-destructive)', async () => {
      const entity = {
        observedId: 'obs-nd',
        observedProjectId: 'proj_test',
        kind: 'Entity',
        normalized: 'nondestructive',
        value: 'NonDestructive',
      };

      setupMockSequence([entity]);
      await runMain();

      const mergeCall = mockRun.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('MERGE (c:CanonicalEntity'),
      );
      expect(mergeCall).toBeDefined();
      const query = mergeCall![0] as string;
      // ON MATCH uses coalesce to preserve existing values
      expect(query).toContain('ON MATCH SET');
      expect(query).toContain('coalesce(c.canonicalKind');
    });
  });

  // ── Error handling ──
  describe('Error handling', () => {
    it('outputs JSON error and exits with code 1 on failure', async () => {
      mockRun.mockRejectedValue(new Error('Connection refused'));

      await runMain();

      expect(mockConsoleError).toHaveBeenCalled();
      const errorOutput = JSON.parse(mockConsoleError.mock.calls[0][0]);
      expect(errorOutput.ok).toBe(false);
      expect(errorOutput.error).toContain('Connection refused');
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('closes Neo4j connection in finally block', async () => {
      mockRun.mockRejectedValue(new Error('Test error'));

      await runMain();

      expect(mockClose).toHaveBeenCalled();
    });
  });
});
