/**
 * GC-7: Entrypoint Dispatch Edges — TDD Spec Tests
 *
 * Tests for MCP tool and CLI command Entrypoint node detection.
 * CodeGraph has 56 MCP tool registrations and 7 CLI commands.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Project } from 'ts-morph';
import { createEphemeralGraph, type EphemeralGraphRuntime } from '../../ephemeral-graph.js';
import { Neo4jService } from '../../../../storage/neo4j/neo4j.service.js';
import neo4jDriver from 'neo4j-driver';
import { enrichEntrypointEdges, extractWebFrameworkRegistrations } from '../../../../scripts/enrichment/create-entrypoint-edges.js';

describe('[GC-7] Entrypoint Dispatch Edges', () => {
  describe('Integration — live graph', () => {
    let neo4j: Neo4jService;

    beforeAll(async () => {
      neo4j = new Neo4jService();

      // Deterministic precondition for live-graph assertions:
      // refresh Entrypoint + DISPATCHES_TO materialization before checking counts.
      const driver = neo4jDriver.driver(
        process.env.NEO4J_URI ?? 'bolt://localhost:7687',
        neo4jDriver.auth.basic(
          process.env.NEO4J_USER ?? 'neo4j',
          process.env.NEO4J_PASSWORD ?? 'codegraph',
        ),
      );
      try {
        await enrichEntrypointEdges(driver);
      } finally {
        await driver.close();
      }
    }, 30000);
    afterAll(async () => { await neo4j.close(); });

    function toNum(val: unknown): number {
      const v = val as any;
      return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
    }

    it('[GC-7] Entrypoint nodes exist after parse', async () => {
      const rows = await neo4j.run(
        `MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'}) RETURN count(e) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-7] MCP tool entrypoints have tool: prefix', async () => {
      const rows = await neo4j.run(
        `MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})
         WHERE e.name STARTS WITH 'tool:'
         RETURN count(e) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-7] CLI command entrypoints have command: prefix', async () => {
      const rows = await neo4j.run(
        `MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})
         WHERE e.name STARTS WITH 'command:'
         RETURN count(e) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-7] DISPATCHES_TO edges link Entrypoint → Function', async () => {
      const rows = await neo4j.run(
        `MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})-[r:DISPATCHES_TO]->(fn:Function)
         RETURN count(r) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-7] DISPATCHES_TO edges have derived=true', async () => {
      const rows = await neo4j.run(
        `MATCH ()-[r:DISPATCHES_TO]->() WHERE r.derived = true RETURN count(r) AS cnt`,
      );
      expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
    });

    it('[GC-7] blast radius query includes DISPATCHES_TO', async () => {
      const rows = await neo4j.run(
        `MATCH (e:Entrypoint {projectId: 'proj_c0d3e9a1f200'})-[:DISPATCHES_TO]->(fn:Function)
         OPTIONAL MATCH (fn)-[:CALLS*1..2]->(downstream:Function)
         WITH e, fn, collect(DISTINCT downstream.name) AS reachable
         RETURN e.name AS entrypoint, fn.name AS handler, size(reachable) AS downstream
         ORDER BY downstream DESC LIMIT 3`,
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

  describe('[GC-7] Web framework registration extraction', () => {
    it('detects Express/Fastify route registrations', () => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('src/web/routes.ts', `
        const app = express();
        const router = app;
        app.get('/health', healthHandler);
        router.post('/users', authMw, createUser);

        const fastify = createFastify();
        fastify.get('/ready', readyHandler);
        fastify.route({ method: 'DELETE', url: '/users/:id', handler: deleteUser });
      `);

      const rows = extractWebFrameworkRegistrations(project);
      const names = rows.map(r => r.name);
      expect(names).toContain('route:GET /health');
      expect(names).toContain('route:POST /users');
      expect(names).toContain('route:GET /ready');
      expect(names).toContain('route:DELETE /users/:id');
    });

    it('detects NestJS controller decorators as route entrypoints', () => {
      const project = new Project({ useInMemoryFileSystem: true });
      project.createSourceFile('src/web/users.controller.ts', `
        @Controller('/users')
        class UsersController {
          @Get('/:id')
          getUser() {}

          @Post('/')
          createUser() {}
        }
      `);

      const rows = extractWebFrameworkRegistrations(project);
      const names = rows.map(r => r.name);
      expect(names).toContain('route:GET /users/:id');
      expect(names).toContain('route:POST /users/');
      expect(rows.some(r => r.framework === 'nest')).toBe(true);
    });
  });
});
