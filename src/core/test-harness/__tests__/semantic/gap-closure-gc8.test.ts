/**
 * GC-8: Generalized State Tracking — TDD Spec Tests
 *
 * Tests for Field nodes, READS_STATE, and WRITES_STATE edges.
 * CodeGraph's TypeScriptParser has ~20 mutable class properties.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../ephemeral-graph.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';

describe('[GC-8] Generalized State Tracking', () => {
  describe('Integration — live graph', () => {
    let neo4j: Neo4jService;

    beforeAll(() => { neo4j = new Neo4jService(); });
    afterAll(async () => { await neo4j.close(); });

    function toNum(val: unknown): number {
      const v = val as any;
      return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
    }

    it('[GC-8] Field nodes exist for TypeScriptParser', async () => {
      const rows = await neo4j.run(
        `MATCH (f:Field {projectId: 'proj_c0d3e9a1f200', className: 'TypeScriptParser'})
         RETURN count(f) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThanOrEqual(15);
    });

    it('[GC-8] Field nodes include module-scope variables', async () => {
      const rows = await neo4j.run(
        `MATCH (f:Field {projectId: 'proj_c0d3e9a1f200'})
         WHERE f.fieldKind = 'module-var'
         RETURN count(f) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-8] READS_STATE edges exist', async () => {
      const rows = await neo4j.run(
        `MATCH ()-[r:READS_STATE]->(f:Field {projectId: 'proj_c0d3e9a1f200'})
         RETURN count(r) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-8] WRITES_STATE edges exist', async () => {
      const rows = await neo4j.run(
        `MATCH ()-[r:WRITES_STATE]->(f:Field {projectId: 'proj_c0d3e9a1f200'})
         RETURN count(r) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-8] parsedNodes field is read by multiple methods', async () => {
      const rows = await neo4j.run(
        `MATCH (fn)-[:READS_STATE]->(f:Field {className: 'TypeScriptParser', name: 'parsedNodes'})
         RETURN count(fn) AS readers`,
      );
      expect(toNum(rows[0]?.readers)).toBeGreaterThanOrEqual(2);
    });

    it('[GC-8] state access query: what state could this function affect?', async () => {
      const rows = await neo4j.run(
        `MATCH (fn {name: 'clearParsedData'})-[r:WRITES_STATE|READS_STATE]->(f:Field)
         RETURN type(r) AS access, f.name AS field
         ORDER BY access, field`,
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('Ephemeral — structural contracts', () => {
    let rt: EphemeralGraphRuntime;

    beforeAll(async () => {
      rt = await createEphemeralGraph({ setupSchema: false });
    });

    afterAll(async () => {
      await rt.teardown();
    });

    it('[GC-8] Field node has required properties', async () => {
      await rt.run(
        `CREATE (f:Field:CodeNode {
          id: $id,
          projectId: $projectId,
          name: 'testField',
          coreType: 'Field',
          filePath: '/test/parser.ts',
          className: 'TestParser',
          fieldKind: 'class-property',
          mutable: true
        })`,
        { id: `${rt.projectId}:field:test`, projectId: rt.projectId },
      );

      const result = await rt.run(
        `MATCH (f:Field {projectId: $projectId})
         RETURN f.name AS name, f.className AS cls, f.mutable AS mutable`,
        { projectId: rt.projectId },
      );
      expect(result.records[0]?.get('name')).toBe('testField');
      expect(result.records[0]?.get('cls')).toBe('TestParser');
      expect(result.records[0]?.get('mutable')).toBe(true);
    });

    it('[GC-8] READS_STATE/WRITES_STATE edges are distinct', async () => {
      await rt.run(
        `MATCH (f:Field {projectId: $projectId})
         CREATE (m:Method:CodeNode {
           id: $mId,
           projectId: $projectId,
           name: 'readMethod',
           filePath: '/test/parser.ts'
         })
         CREATE (w:Method:CodeNode {
           id: $wId,
           projectId: $projectId,
           name: 'writeMethod',
           filePath: '/test/parser.ts'
         })
         CREATE (m)-[:READS_STATE {derived: true}]->(f)
         CREATE (w)-[:WRITES_STATE {derived: true}]->(f)`,
        {
          projectId: rt.projectId,
          mId: `${rt.projectId}:m:read`,
          wId: `${rt.projectId}:m:write`,
        },
      );

      const result = await rt.run(
        `MATCH (n)-[r]->(f:Field {projectId: $projectId})
         RETURN type(r) AS rel, n.name AS accessor
         ORDER BY rel`,
        { projectId: rt.projectId },
      );
      const rels = result.records.map((r) => r.get('rel'));
      expect(rels).toContain('READS_STATE');
      expect(rels).toContain('WRITES_STATE');
    });
  });
});
