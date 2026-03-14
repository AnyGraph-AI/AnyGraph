/**
 * Direct ingest: Load godspeed-full-graph.json → Neo4j (no APOC required)
 * Reads the already-parsed JSON and loads nodes/edges with proper labels and properties.
 */
import neo4j from 'neo4j-driver';
import { readFileSync, existsSync } from 'fs';

const GRAPH_FILE = 'godspeed-full-graph.json';
const PROJECT_ID = 'proj_60d5feed0001';
const NEO4J_URI = 'bolt://localhost:7687';
const NEO4J_USER = 'neo4j';
const NEO4J_PASSWORD = 'codegraph';
const BATCH_SIZE = 200;

async function main() {
  console.time('total');

  // 1. Load parsed graph
  if (!existsSync(GRAPH_FILE)) {
    console.error(`${GRAPH_FILE} not found. Run the parser first.`);
    process.exit(1);
  }
  console.log('Loading graph data...');
  const data = JSON.parse(readFileSync(GRAPH_FILE, 'utf-8'));
  console.log(`Loaded: ${data.nodes.length} nodes, ${data.edges.length} edges`);

  // 2. Connect to Neo4j
  const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  const session = driver.session();

  try {
    // 3. Clear existing data for this project
    console.log('Clearing existing graph data...');
    await session.run('MATCH (n {projectId: $projectId}) DETACH DELETE n', { projectId: PROJECT_ID });

    // 4. Create indexes
    console.log('Creating indexes...');
    await session.run('CREATE INDEX codegraph_id_idx IF NOT EXISTS FOR (n:CodeNode) ON (n.id)');
    await session.run('CREATE INDEX codegraph_name_idx IF NOT EXISTS FOR (n:CodeNode) ON (n.name)');
    await session.run('CREATE INDEX codegraph_project_idx IF NOT EXISTS FOR (n:CodeNode) ON (n.projectId)');

    // 5. Ingest nodes - group by label combination for efficient MERGE
    console.log('Ingesting nodes...');
    console.time('nodes');

    // Group nodes by their label set
    const nodesByLabels = new Map<string, any[]>();
    for (const node of data.nodes) {
      const labels = node.labels || ['CodeNode'];
      const labelKey = ['CodeNode', ...labels].sort().join(':');
      if (!nodesByLabels.has(labelKey)) nodesByLabels.set(labelKey, []);
      nodesByLabels.get(labelKey)!.push(node);
    }

    // Flatten nested objects to JSON strings (Neo4j only supports primitives)
    function flattenProps(props: Record<string, any>): Record<string, any> {
      const flat: Record<string, any> = {};
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'object' && !Array.isArray(v)) {
          flat[k] = JSON.stringify(v); // Stringify nested maps
        } else if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object') {
          flat[k] = JSON.stringify(v); // Stringify arrays of objects
        } else {
          flat[k] = v;
        }
      }
      return flat;
    }

    let nodeCount = 0;
    for (const [labelKey, nodes] of nodesByLabels) {
      const labelStr = labelKey;
      for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        const props = batch.map((n: any) => flattenProps(n.properties));

        await session.run(`
          UNWIND $props AS p
          CREATE (n:${labelStr})
          SET n = p
        `, { props });

        nodeCount += batch.length;
        process.stdout.write(`\r  ${nodeCount}/${data.nodes.length} nodes`);
      }
    }
    console.log();
    console.timeEnd('nodes');

    // 6. Ingest edges - group by type
    console.log('Ingesting edges...');
    console.time('edges');

    const edgesByType = new Map<string, any[]>();
    for (const edge of data.edges) {
      const t = edge.type || edge.labels?.[0] || 'RELATED_TO';
      if (!edgesByType.has(t)) edgesByType.set(t, []);
      edgesByType.get(t)!.push(edge);
    }

    let edgeCount = 0;
    for (const [relType, edges] of edgesByType) {
      const safeType = relType.replace(/[^a-zA-Z0-9_]/g, '');
      for (let i = 0; i < edges.length; i += BATCH_SIZE) {
        const batch = edges.slice(i, i + BATCH_SIZE);
        const edgeData = batch.map((e: any) => ({
          sourceId: e.startNodeId || e.sourceId || e.source,
          targetId: e.endNodeId || e.targetId || e.target,
          props: flattenProps(e.properties || {}),
        }));

        await session.run(`
          UNWIND $edges AS ed
          MATCH (src:CodeNode {id: ed.sourceId})
          MATCH (tgt:CodeNode {id: ed.targetId})
          CREATE (src)-[r:${safeType}]->(tgt)
          SET r = ed.props
        `, { edges: edgeData });

        edgeCount += batch.length;
        process.stdout.write(`\r  ${edgeCount}/${data.edges.length} edges [${relType}]`);
      }
    }
    console.log();
    console.timeEnd('edges');

    // 7. Verify
    console.log('\nVerifying...');
    const nodeCheck = await session.run(`
      MATCH (n:CodeNode {projectId: $projectId})
      RETURN n.coreType AS type, count(*) AS cnt ORDER BY cnt DESC
    `, { projectId: PROJECT_ID });
    console.log('Node types:');
    for (const r of nodeCheck.records) {
      console.log(`  ${r.get('type')}: ${r.get('cnt').toNumber()}`);
    }

    const edgeCheck = await session.run(`
      MATCH (:CodeNode)-[r]->(:CodeNode)
      RETURN type(r) AS type, count(*) AS cnt ORDER BY cnt DESC
    `);
    console.log('Edge types:');
    for (const r of edgeCheck.records) {
      console.log(`  ${r.get('type')}: ${r.get('cnt').toNumber()}`);
    }

    // 8. Demo queries
    console.log('\n=== BLAST RADIUS: executeOrder ===');
    const blast = await session.run(`
      MATCH (fn:CodeNode {name: 'executeOrder'})
      OPTIONAL MATCH (caller:CodeNode)-[:CALLS]->(fn)
      OPTIONAL MATCH (imp:CodeNode)-[:RESOLVES_TO]->(fn)
      OPTIONAL MATCH (imp)<-[:CONTAINS]-(sf:CodeNode {coreType: 'SourceFile'})
      RETURN fn.name AS target,
             fn.filePath AS file,
             collect(DISTINCT caller.name) AS directCallers,
             collect(DISTINCT sf.name) AS importingFiles
    `);
    for (const r of blast.records) {
      console.log(`  Target: ${r.get('target')} in ${r.get('file')}`);
      console.log(`  Direct callers: ${JSON.stringify(r.get('directCallers'))}`);
      console.log(`  Importing files: ${JSON.stringify(r.get('importingFiles'))}`);
    }

    console.log('\n=== COMMAND HANDLERS ===');
    const cmds = await session.run(`
      MATCH (h:CodeNode)-[:REGISTERED_BY]->(ep:CodeNode)
      WHERE ep.coreType = 'Entrypoint' AND ep.registrationKind = 'command'
      RETURN ep.registrationTrigger AS command, h.name AS handler, h.filePath AS file
      ORDER BY command
      LIMIT 20
    `);
    for (const r of cmds.records) {
      console.log(`  /${r.get('command')} → ${r.get('handler')}`);
    }

    console.log('\n=== TOP 10 MOST-CALLED FUNCTIONS ===');
    const hotFns = await session.run(`
      MATCH (caller:CodeNode)-[:CALLS]->(fn:CodeNode)
      WHERE fn.coreType = 'FunctionDeclaration'
      RETURN fn.name AS name, fn.filePath AS file, count(caller) AS callerCount
      ORDER BY callerCount DESC
      LIMIT 10
    `);
    for (const r of hotFns.records) {
      const file = (r.get('file') as string)?.split('/').pop();
      console.log(`  ${r.get('name')} (${file}): ${r.get('callerCount').toNumber()} callers`);
    }

    console.timeEnd('total');
    console.log('\n✅ GodSpeed graph loaded into Neo4j!');
    console.log('   Browser: http://localhost:7474');
    console.log('   Bolt:    bolt://localhost:7687');
    console.log(`   Project: ${PROJECT_ID}`);

  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
