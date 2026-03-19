/**
 * SG-1: Parse CodeGraph itself and ingest into Neo4j as a separate project.
 * No framework schema — pure TypeScript structural analysis.
 */
import { TypeScriptParser } from '../../../src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from '../../../src/core/config/schema.js';
import neo4j from 'neo4j-driver';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { validateProjectWrite } from '../../core/guards/project-write-guard.js';

const CODEGRAPH_PATH = '/home/jonathan/.openclaw/workspace/codegraph/';
const PROJECT_ID = 'proj_c0d3e9a1f200';
const PROJECT_NAME = 'CodeGraph';
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

  // 1. Find all TypeScript files — src/ + top-level scripts + tests
  const tsFiles = execSync(
    `find ${CODEGRAPH_PATH}src -name '*.ts' -not -path '*/node_modules/*' -not -name '*.d.ts' && ` +
    `find ${CODEGRAPH_PATH} -maxdepth 1 -name '*.ts' -not -name '*.d.ts' && ` +
    `find ${CODEGRAPH_PATH}tests -name '*.ts' -not -name '*.d.ts' 2>/dev/null`
  ).toString().trim().split('\n').filter(Boolean);
  console.log(`Found ${tsFiles.length} TypeScript files for self-graph`);

  // 2. Parse — NO framework schema, pure TypeScript
  console.time('parse');
  const parser = new TypeScriptParser(
    CODEGRAPH_PATH, 'tsconfig.json', CORE_TYPESCRIPT_SCHEMA,
    [], // No framework schemas
    undefined, PROJECT_ID,
  );
  const result = await parser.parseChunk(tsFiles);
  console.timeEnd('parse');
  console.log(`Parsed: ${result.nodes.length} nodes, ${result.edges.length} edges`);

  // Save graph JSON
  const graphData = {
    summary: { files: tsFiles.length, nodes: result.nodes.length, edges: result.edges.length },
    nodeTypes: result.nodes.reduce((a: any, n: any) => { const t = n.labels?.[0] || '?'; a[t] = (a[t]||0)+1; return a; }, {}),
    edgeTypes: result.edges.reduce((a: any, e: any) => { a[e.type] = (a[e.type]||0)+1; return a; }, {}),
  };
  writeFileSync('codegraph-self-graph.json', JSON.stringify(graphData, null, 2));
  console.log('Saved summary to codegraph-self-graph.json');

  // 3. Connect + clear ONLY self-graph nodes (preserve GodSpeed)
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  await validateProjectWrite(driver as any, PROJECT_ID);
  const session = driver.session();

  try {
    console.log('Clearing existing self-graph (preserving GodSpeed)...');
    await session.run('MATCH (n {projectId: $pid}) DETACH DELETE n', { pid: PROJECT_ID });

    // Ensure indexes exist
    await session.run('CREATE INDEX cg_id IF NOT EXISTS FOR (n:CodeNode) ON (n.id)');
    await session.run('CREATE INDEX cg_name IF NOT EXISTS FOR (n:CodeNode) ON (n.name)');
    await session.run('CREATE INDEX cg_proj IF NOT EXISTS FOR (n:CodeNode) ON (n.projectId)');

    // 4. Ingest nodes
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

    // 5. Ingest edges
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

    // 6. Stats
    const nodeStats = await session.executeRead(tx =>
      tx.run('MATCH (n:CodeNode {projectId: $pid}) RETURN labels(n) AS labels, count(*) AS cnt ORDER BY cnt DESC', { pid: PROJECT_ID })
    );
    console.log('\n=== SELF-GRAPH NODE LABELS ===');
    for (const r of nodeStats.records) {
      console.log(`  ${r.get('labels').join(':')}: ${r.get('cnt').toNumber()}`);
    }

    const edgeStats = await session.executeRead(tx =>
      tx.run(`MATCH (s:CodeNode {projectId: $pid})-[r]->(t:CodeNode {projectId: $pid})
              RETURN type(r) AS type, count(*) AS cnt ORDER BY cnt DESC`, { pid: PROJECT_ID })
    );
    console.log('Edge types:');
    for (const r of edgeStats.records) {
      console.log(`  ${r.get('type')}: ${r.get('cnt').toNumber()}`);
    }

    // 7. Demo: what are the riskiest parser functions?
    console.log('\n=== TOP 10 MOST-CALLED (CodeGraph) ===');
    const hot = await session.executeRead(tx => tx.run(`
      MATCH (caller:CodeNode {projectId: $pid})-[:CALLS]->(fn:Function {projectId: $pid})
      RETURN fn.name AS name, fn.filePath AS file, count(DISTINCT caller) AS callers
      ORDER BY callers DESC LIMIT 10
    `, { pid: PROJECT_ID }));
    for (const r of hot.records) {
      console.log(`  ${r.get('name')}: ${r.get('callers').toNumber()} callers (${r.get('file')})`);
    }

    // 8. Verify no cross-contamination with GodSpeed
    const gsCount = await session.executeRead(tx =>
      tx.run('MATCH (n:CodeNode {projectId: $pid}) RETURN count(n) AS cnt', { pid: 'proj_60d5feed0001' })
    );
    console.log(`\nGodSpeed nodes still intact: ${gsCount.records[0].get('cnt').toNumber()}`);

    console.timeEnd('total');
    console.log('\n✅ CodeGraph self-graph loaded as projectId=' + PROJECT_ID);
    console.log('   Both graphs coexist in the same Neo4j instance.');

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
