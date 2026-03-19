/**
 * Parse GodSpeed (excluding src/src/ legacy copy) and ingest into Neo4j.
 */
import { TypeScriptParser } from '../../../src/core/parsers/typescript-parser.js';
import { GRAMMY_FRAMEWORK_SCHEMA } from '../../../src/core/config/grammy-framework-schema.js';
import { CORE_TYPESCRIPT_SCHEMA } from '../../../src/core/config/schema.js';
import neo4j from 'neo4j-driver';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { validateProjectWrite } from '../../core/guards/project-write-guard.js';

const GODSPEED_PATH = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/';
const PROJECT_ID = 'proj_60d5feed0001';
const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'codegraph';
const BATCH_SIZE = 200;

function flattenProps(props: Record<string, any>): Record<string, any> {
  const flat: Record<string, any> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      flat[k] = JSON.stringify(v);
    } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
      flat[k] = JSON.stringify(v);
    } else {
      flat[k] = v;
    }
  }
  return flat;
}

async function main() {
  console.time('total');

  // 1. Find files — EXCLUDE src/src/ (legacy copy of codebase)
  const tsFiles = execSync(
    `find ${GODSPEED_PATH}src -name '*.ts' -not -path '*/node_modules/*' -not -path '*/src/src/*' -not -name '*.d.ts'`
  ).toString().trim().split('\n').filter(Boolean);
  console.log(`Found ${tsFiles.length} TypeScript files (excluding src/src/ legacy)`);

  // 2. Parse
  console.time('parse');
  const parser = new TypeScriptParser(
    GODSPEED_PATH, 'tsconfig.json', CORE_TYPESCRIPT_SCHEMA,
    [GRAMMY_FRAMEWORK_SCHEMA as any], undefined, PROJECT_ID,
  );
  const result = await parser.parseChunk(tsFiles);
  console.timeEnd('parse');
  console.log(`Parsed: ${result.nodes.length} nodes, ${result.edges.length} edges`);

  // Save full graph JSON
  const graphData = {
    summary: { files: tsFiles.length, nodes: result.nodes.length, edges: result.edges.length },
    nodeTypes: result.nodes.reduce((a: any, n: any) => { const t = n.labels?.[0] || '?'; a[t] = (a[t]||0)+1; return a; }, {}),
    edgeTypes: result.edges.reduce((a: any, e: any) => { a[e.type] = (a[e.type]||0)+1; return a; }, {}),
    nodes: result.nodes,
    edges: result.edges,
  };
  writeFileSync('godspeed-clean-graph.json', JSON.stringify(graphData, null, 2));
  console.log('Saved to godspeed-clean-graph.json');

  // 3. Connect + clear + index
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await validateProjectWrite(driver as any, PROJECT_ID);
  const session = driver.session();

  try {
    console.log('Clearing existing graph...');
    await session.run('MATCH (n {projectId: $pid}) DETACH DELETE n', { pid: PROJECT_ID });

    await session.run('CREATE INDEX cg_id IF NOT EXISTS FOR (n:CodeNode) ON (n.id)');
    await session.run('CREATE INDEX cg_name IF NOT EXISTS FOR (n:CodeNode) ON (n.name)');
    await session.run('CREATE INDEX cg_proj IF NOT EXISTS FOR (n:CodeNode) ON (n.projectId)');

    // 4. Ingest nodes grouped by label combo
    console.log('Ingesting nodes...');
    console.time('nodes');
    const nodesByLabels = new Map<string, any[]>();
    for (const node of result.nodes) {
      const labels = node.labels || ['CodeNode'];
      const key = ['CodeNode', ...labels].sort().join(':');
      if (!nodesByLabels.has(key)) nodesByLabels.set(key, []);
      nodesByLabels.get(key)!.push(node);
    }

    let nc = 0;
    for (const [labelStr, nodes] of nodesByLabels) {
      for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        await session.run(
          `UNWIND $props AS p CREATE (n:${labelStr}) SET n = p`,
          { props: batch.map((n: any) => flattenProps(n.properties)) }
        );
        nc += batch.length;
      }
    }
    console.log(`  ${nc} nodes`);
    console.timeEnd('nodes');

    // 5. Ingest edges grouped by type
    console.log('Ingesting edges...');
    console.time('edges');
    const edgesByType = new Map<string, any[]>();
    for (const edge of result.edges) {
      const t = edge.type || 'RELATED_TO';
      if (!edgesByType.has(t)) edgesByType.set(t, []);
      edgesByType.get(t)!.push(edge);
    }

    let ec = 0;
    for (const [relType, edges] of edgesByType) {
      const safe = relType.replace(/[^a-zA-Z0-9_]/g, '');
      for (let i = 0; i < edges.length; i += BATCH_SIZE) {
        const batch = edges.slice(i, i + BATCH_SIZE);
        await session.run(
          `UNWIND $edges AS ed
           MATCH (src:CodeNode {id: ed.sourceId})
           MATCH (tgt:CodeNode {id: ed.targetId})
           CREATE (src)-[r:${safe}]->(tgt)
           SET r = ed.props`,
          { edges: batch.map((e: any) => ({
            sourceId: e.startNodeId || e.sourceId,
            targetId: e.endNodeId || e.targetId,
            props: flattenProps(e.properties || {}),
          }))}
        );
        ec += batch.length;
      }
    }
    console.log(`  ${ec} edges`);
    console.timeEnd('edges');

    // 6. Verify via HTTP-style queries
    const nodeStats = await session.executeRead(tx =>
      tx.run('MATCH (n:CodeNode) RETURN labels(n) AS labels, count(*) AS cnt ORDER BY cnt DESC')
    );
    console.log('\nNode labels:');
    for (const r of nodeStats.records) {
      console.log(`  ${r.get('labels').join(':')}: ${r.get('cnt').toNumber()}`);
    }

    const edgeStats = await session.executeRead(tx =>
      tx.run('MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS cnt ORDER BY cnt DESC')
    );
    console.log('Edge types:');
    for (const r of edgeStats.records) {
      console.log(`  ${r.get('type')}: ${r.get('cnt').toNumber()}`);
    }

    // 7. Demo queries
    console.log('\n=== BLAST RADIUS: executeOrder ===');
    const blast = await session.executeRead(tx => tx.run(`
      MATCH (fn:Function {name: 'executeOrder'})
      OPTIONAL MATCH (caller)-[:CALLS]->(fn)
      OPTIONAL MATCH (imp)-[:RESOLVES_TO]->(fn)
      OPTIONAL MATCH (imp)<-[:CONTAINS]-(sf:SourceFile)
      RETURN fn.name AS target, fn.filePath AS file,
             collect(DISTINCT caller.name) AS callers,
             collect(DISTINCT sf.name) AS importers
    `));
    for (const r of blast.records) {
      console.log(`  ${r.get('target')} in ${r.get('file')}`);
      console.log(`  Callers: ${JSON.stringify(r.get('callers'))}`);
      console.log(`  Importing files: ${JSON.stringify(r.get('importers'))}`);
    }

    console.log('\n=== TOP 10 MOST-CALLED ===');
    const hot = await session.executeRead(tx => tx.run(`
      MATCH (caller)-[:CALLS]->(fn:Function)
      RETURN fn.name AS name, count(DISTINCT caller) AS callers
      ORDER BY callers DESC LIMIT 10
    `));
    for (const r of hot.records) {
      console.log(`  ${r.get('name')}: ${r.get('callers').toNumber()} callers`);
    }

    console.log('\n=== COMMAND HANDLERS ===');
    const cmds = await session.executeRead(tx => tx.run(`
      MATCH (h:Function)-[:REGISTERED_BY]->(ep:Entrypoint)
      WHERE ep.name STARTS WITH 'command:'
      RETURN ep.name AS entry, h.name AS handler ORDER BY entry
    `));
    for (const r of cmds.records) {
      console.log(`  ${r.get('entry')} → ${r.get('handler')}`);
    }

    console.timeEnd('total');
    console.log('\n✅ GodSpeed graph loaded (clean, no duplicates)');
    console.log('   http://localhost:7474  |  bolt://localhost:7687  |  neo4j/codegraph');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
