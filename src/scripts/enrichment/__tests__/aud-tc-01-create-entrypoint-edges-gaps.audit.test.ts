/**
 * AUD-TC-01 Gap-Fill: create-entrypoint-edges.ts — Integration Tests
 *
 * Fills coverage gaps identified in audit:
 * 1. enrichEntrypointEdges() creates Entrypoint nodes in Neo4j
 * 2. DISPATCHES_TO edges created from Entrypoint → handler Function
 * 3. extractMcpRegistrations() detects both server.tool() AND server.registerTool() patterns
 * 4. extractCommanderRegistrations() detects .command().action() chain
 * 5. MCP entrypoints get correct name/description/kind properties
 * 6. Idempotency — re-run doesn't create duplicate Entrypoint nodes
 *
 * Existing tests in gap-closure-gc7.test.ts cover high-level integration.
 * This file adds specific unit tests for extractMcpRegistrations patterns.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Project } from 'ts-morph';
import neo4jDriver from 'neo4j-driver';
import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';
import {
  enrichEntrypointEdges,
  extractMcpRegistrations,
  extractCommanderRegistrations,
} from '../create-entrypoint-edges.js';

const PROJECT_ID = 'proj_c0d3e9a1f200';

describe('[aud-tc-01-create-entrypoint-edges-gaps] Integration — enrichEntrypointEdges pipeline', () => {
  let neo4j: Neo4jService;
  let driver: ReturnType<typeof neo4jDriver.driver>;

  beforeAll(() => {
    neo4j = new Neo4jService();
    driver = neo4jDriver.driver(
      process.env.NEO4J_URI ?? 'bolt://localhost:7687',
      neo4jDriver.auth.basic(
        process.env.NEO4J_USER ?? 'neo4j',
        process.env.NEO4J_PASSWORD ?? 'codegraph',
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await neo4j.close();
    await driver.close();
  });

  function toNum(val: unknown): number {
    const v = val as any;
    return typeof v?.toNumber === 'function' ? v.toNumber() : Number(v);
  }

  it('(1) enrichEntrypointEdges() creates Entrypoint nodes in Neo4j', async () => {
    const result = await enrichEntrypointEdges(driver);

    // Verify entrypoints exist in graph
    const rows = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId}) RETURN count(e) AS cnt`,
      { projectId: PROJECT_ID },
    );

    expect(result.entrypoints).toBeGreaterThan(0);
    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  }, 60_000);

  it('(2) DISPATCHES_TO edges link Entrypoint → handler (Function or Variable)', async () => {
    const rows = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId})-[r:DISPATCHES_TO]->(fn)
       WHERE fn:Function OR fn:Variable OR fn:Method
       RETURN count(r) AS cnt`,
      { projectId: PROJECT_ID },
    );

    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  }, 60_000);

  it('(3) MCP entrypoints have kind=tool and framework=mcp', async () => {
    const rows = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId})
       WHERE e.name STARTS WITH 'tool:'
         AND e.entrypointKind = 'tool'
         AND e.framework = 'mcp'
       RETURN count(e) AS cnt`,
      { projectId: PROJECT_ID },
    );

    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  }, 60_000);

  it('(4) CLI entrypoints have kind=command and framework=commander', async () => {
    const rows = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId})
       WHERE e.name STARTS WITH 'command:'
         AND e.entrypointKind = 'command'
         AND e.framework = 'commander'
       RETURN count(e) AS cnt`,
      { projectId: PROJECT_ID },
    );

    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  }, 60_000);

  it('(5) DISPATCHES_TO edges have {derived: true, source: "entrypoint-enrichment"}', async () => {
    const rows = await neo4j.run(
      `MATCH ()-[r:DISPATCHES_TO]->()
       WHERE r.derived = true AND r.source = 'entrypoint-enrichment'
       RETURN count(r) AS cnt`,
    );

    expect(toNum(rows[0]?.cnt)).toBeGreaterThan(0);
  }, 60_000);

  it('(6) Re-run is idempotent — MERGE semantics, no duplicate Entrypoint nodes', async () => {
    // First run
    const result1 = await enrichEntrypointEdges(driver);
    const count1 = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId}) RETURN count(e) AS cnt`,
      { projectId: PROJECT_ID },
    );

    // Second run
    const result2 = await enrichEntrypointEdges(driver);
    const count2 = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId}) RETURN count(e) AS cnt`,
      { projectId: PROJECT_ID },
    );

    // Entrypoint count should be stable
    expect(toNum(count1[0]?.cnt)).toBe(toNum(count2[0]?.cnt));
    expect(result1.entrypoints).toBe(result2.entrypoints);
  }, 60_000);

  it('(7) All Entrypoint nodes have required properties (id, projectId, name, filePath)', async () => {
    const badRows = await neo4j.run(
      `MATCH (e:Entrypoint {projectId: $projectId})
       WHERE e.id IS NULL OR e.name IS NULL OR e.filePath IS NULL
       RETURN count(e) AS bad`,
      { projectId: PROJECT_ID },
    );

    expect(toNum(badRows[0]?.bad)).toBe(0);
  }, 60_000);
});

describe('[aud-tc-01-create-entrypoint-edges-gaps] extractMcpRegistrations — pattern detection', () => {
  it('(8) detects server.tool(name, description, schema, handler) pattern', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/mcp/tools/test.tool.ts', `
      import { server } from './server';

      server.tool('test_tool', 'A test tool', { schema: {} }, async () => {
        return { result: 'ok' };
      });
    `);

    const results = extractMcpRegistrations(project);
    const testTool = results.find((r) => r.name === 'tool:test_tool');

    expect(testTool).toBeDefined();
    expect(testTool?.kind).toBe('tool');
    expect(testTool?.framework).toBe('mcp');
  });

  it('(9) detects server.registerTool(name, schema, handler) pattern', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/mcp/tools/registered.tool.ts', `
      import { server } from './server';

      server.registerTool('registered_tool', { type: 'object' }, handleTool);

      async function handleTool() { return {}; }
    `);

    const results = extractMcpRegistrations(project);
    const regTool = results.find((r) => r.name === 'tool:registered_tool');

    expect(regTool).toBeDefined();
    expect(regTool?.kind).toBe('tool');
    expect(regTool?.framework).toBe('mcp');
    expect(regTool?.handlerName).toBe('handleTool');
  });

  it('(10) detects server.registerTool with TOOL_NAMES.xxx reference', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/mcp/handlers/named.handler.ts', `
      const TOOL_NAMES = { SELF_AUDIT: 'self_audit' };
      server.registerTool(TOOL_NAMES.SELF_AUDIT, {}, selfAuditHandler);
    `);

    const results = extractMcpRegistrations(project);
    const namedTool = results.find((r) => r.name === 'tool:SELF_AUDIT');

    expect(namedTool).toBeDefined();
    expect(namedTool?.kind).toBe('tool');
  });

  it('(11) extracts handler name when last argument is identifier', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/mcp/tools/handler.tool.ts', `
      server.tool('with_handler', 'desc', {}, myHandler);
      async function myHandler() {}
    `);

    const results = extractMcpRegistrations(project);
    const tool = results.find((r) => r.name === 'tool:with_handler');

    expect(tool).toBeDefined();
    expect(tool?.handlerName).toBe('myHandler');
  });

  it('(12) handles anonymous arrow function as handler (no handlerName)', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/mcp/tools/anon.tool.ts', `
      server.tool('anon_tool', 'desc', {}, async () => ({ ok: true }));
    `);

    const results = extractMcpRegistrations(project);
    const tool = results.find((r) => r.name === 'tool:anon_tool');

    expect(tool).toBeDefined();
    // handlerName is undefined for anonymous functions
    expect(tool?.handlerName).toBeUndefined();
  });
});

describe('[aud-tc-01-create-entrypoint-edges-gaps] extractCommanderRegistrations — chain detection', () => {
  it('(13) detects .command().action() chain pattern', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/cli/commands.ts', `
      program.command('build').action(buildHandler);
    `);

    const results = extractCommanderRegistrations(project);
    const cmd = results.find((r) => r.name === 'command:build');

    expect(cmd).toBeDefined();
    expect(cmd?.kind).toBe('command');
    expect(cmd?.framework).toBe('commander');
    expect(cmd?.handlerName).toBe('buildHandler');
  });

  it('(14) extracts command name from .command("name <arg>") (strips arguments)', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/cli/parse.ts', `
      program.command('parse <directory>').action(parseDir);
    `);

    const results = extractCommanderRegistrations(project);
    const cmd = results.find((r) => r.name === 'command:parse');

    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('command:parse'); // Not 'command:parse <directory>'
  });

  it('(15) handles .command().description().action() chain', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('/src/cli/full-chain.ts', `
      program
        .command('serve')
        .description('Start the server')
        .action(startServer);
    `);

    const results = extractCommanderRegistrations(project);
    const cmd = results.find((r) => r.name === 'command:serve');

    expect(cmd).toBeDefined();
    expect(cmd?.handlerName).toBe('startServer');
  });
});
