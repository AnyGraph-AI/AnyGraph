/**
 * GC-7: Entrypoint Dispatch Edges — TDD Spec Tests
 *
 * Tests for MCP tool and CLI command Entrypoint node detection.
 * CodeGraph has 56 MCP tool registrations and 7 CLI commands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../ephemeral-graph.js';

describe('[GC-7] Entrypoint Dispatch Edges', () => {
  describe('Integration — live graph', () => {
    it('[GC-7] Entrypoint nodes exist after parse', () => {
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})
          RETURN count(e) AS cnt" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      const cnt = parseInt(out.split('\n').pop()!);
      // Should have MCP tool + CLI command entrypoints
      expect(cnt).toBeGreaterThan(0);
    });

    it('[GC-7] MCP tool entrypoints have tool: prefix', () => {
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})
          WHERE e.name STARTS WITH 'tool:'
          RETURN count(e) AS cnt" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      const cnt = parseInt(out.split('\n').pop()!);
      expect(cnt).toBeGreaterThan(0);
    });

    it('[GC-7] CLI command entrypoints have command: prefix', () => {
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})
          WHERE e.name STARTS WITH 'command:'
          RETURN count(e) AS cnt" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      const cnt = parseInt(out.split('\n').pop()!);
      expect(cnt).toBeGreaterThan(0);
    });

    it('[GC-7] DISPATCHES_TO edges link Entrypoint → Function', () => {
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})-[r:DISPATCHES_TO]->(fn:Function)
          RETURN count(r) AS cnt" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      const cnt = parseInt(out.split('\n').pop()!);
      expect(cnt).toBeGreaterThan(0);
    });

    it('[GC-7] DISPATCHES_TO edges have derived=true', () => {
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH ()-[r:DISPATCHES_TO]->()
          WHERE r.derived = true
          RETURN count(r) AS cnt" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      const cnt = parseInt(out.split('\n').pop()!);
      expect(cnt).toBeGreaterThan(0);
    });

    it('[GC-7] blast radius query includes DISPATCHES_TO', () => {
      // Verify DISPATCHES_TO participates in multi-hop traversal
      const out = execSync(
        `cypher-shell -u neo4j -p codegraph "
          MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})-[:DISPATCHES_TO]->(fn:Function)
          OPTIONAL MATCH (fn)-[:CALLS*1..2]->(downstream:Function)
          WITH e, fn, collect(DISTINCT downstream.name) AS reachable
          RETURN e.name AS entrypoint, fn.name AS handler, size(reachable) AS downstream
          ORDER BY downstream DESC LIMIT 3" 2>/dev/null`,
        { encoding: 'utf-8' },
      ).trim();
      // Should return rows — entrypoints that dispatch to functions with downstream calls
      expect(out.split('\n').length).toBeGreaterThan(1); // header + at least 1 data row
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

    it('[GC-7] Entrypoint node has required properties', async () => {
      await rt.run(
        `CREATE (e:Entrypoint:CodeNode {
          id: $id,
          projectId: $projectId,
          name: 'tool:test_tool',
          coreType: 'FunctionDeclaration',
          filePath: '/test/tools/test.tool.ts',
          startLine: 10,
          endLine: 10,
          entrypointKind: 'tool',
          framework: 'mcp'
        })`,
        { id: `${rt.projectId}:ep:test`, projectId: rt.projectId },
      );

      const result = await rt.run(
        `MATCH (e:Entrypoint {projectId: $projectId})
         RETURN e.name AS name, e.entrypointKind AS kind, e.framework AS fw`,
        { projectId: rt.projectId },
      );
      expect(result.records[0]?.get('name')).toBe('tool:test_tool');
      expect(result.records[0]?.get('kind')).toBe('tool');
      expect(result.records[0]?.get('fw')).toBe('mcp');
    });

    it('[GC-7] DISPATCHES_TO edge has correct properties', async () => {
      await rt.run(
        `CREATE (fn:Function:CodeNode {
          id: $fnId,
          projectId: $projectId,
          name: 'handleTestTool',
          filePath: '/test/tools/test.tool.ts'
        })`,
        { fnId: `${rt.projectId}:fn:handler`, projectId: rt.projectId },
      );

      await rt.run(
        `MATCH (e:Entrypoint {projectId: $projectId})
         MATCH (fn:Function {id: $fnId})
         CREATE (e)-[r:DISPATCHES_TO {
           derived: true,
           source: 'entrypoint-enrichment',
           framework: 'mcp',
           kind: 'tool'
         }]->(fn)`,
        { projectId: rt.projectId, fnId: `${rt.projectId}:fn:handler` },
      );

      const result = await rt.run(
        `MATCH (e:Entrypoint)-[r:DISPATCHES_TO]->(fn:Function)
         WHERE e.projectId = $projectId
         RETURN r.derived AS derived, r.framework AS fw, r.kind AS kind`,
        { projectId: rt.projectId },
      );
      expect(result.records[0]?.get('derived')).toBe(true);
      expect(result.records[0]?.get('fw')).toBe('mcp');
    });

    it('[GC-7] DISPATCHES_TO is idempotent with MERGE', async () => {
      for (let i = 0; i < 2; i++) {
        await rt.run(
          `MATCH (e:Entrypoint {projectId: $projectId})
           MATCH (fn:Function {id: $fnId})
           MERGE (e)-[r:DISPATCHES_TO]->(fn)
           ON CREATE SET r.derived = true`,
          { projectId: rt.projectId, fnId: `${rt.projectId}:fn:handler` },
        );
      }

      const result = await rt.run(
        `MATCH (e:Entrypoint {projectId: $projectId})-[r:DISPATCHES_TO]->(fn)
         RETURN count(r) AS cnt`,
        { projectId: rt.projectId },
      );
      const cnt = result.records[0]?.get('cnt')?.toNumber?.() ?? result.records[0]?.get('cnt');
      expect(cnt).toBe(1);
    });
  });
});
