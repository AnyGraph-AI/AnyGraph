#!/usr/bin/env node
/**
 * CodeGraph CLI
 *
 * Commands:
 *   init          - Set up Neo4j (native or Docker) and verify connection
 *   parse <dir>   - Parse a TypeScript project into the graph
 *   enrich [id]   - Run post-ingest enrichment pipeline
 *   serve         - Start the MCP server
 *   risk <target> - Query blast radius for a function
 *   analyze <dir> - Parse + enrich + report (one-shot)
 *   status        - Show Neo4j and project status
 *   stop          - Stop Neo4j (Docker mode only)
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { dirname, join, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { createHash } from 'crypto';

import { Command } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── Neo4j Connection ───────────────────────────────────────────────────────

export function getNeo4jConfig() {
  return {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'codegraph',
  };
}

export async function checkNeo4j(): Promise<boolean> {
  const config = getNeo4jConfig();
  try {
    const neo4j = await import('neo4j-driver');
    const driver = neo4j.default.driver(config.uri, neo4j.default.auth.basic(config.user, config.password));
    const session = driver.session();
    await session.run('RETURN 1');
    await session.close();
    await driver.close();
    return true;
  } catch {
    return false;
  }
}

export async function queryNeo4j(cypher: string, params: Record<string, any> = {}): Promise<any[]> {
  const config = getNeo4jConfig();
  const neo4j = await import('neo4j-driver');
  const driver = neo4j.default.driver(config.uri, neo4j.default.auth.basic(config.user, config.password));
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records.map(r => {
      const obj: any = {};
      r.keys.forEach(k => {
        const val = r.get(k);
        obj[k] = typeof val?.toNumber === 'function' ? val.toNumber() : val;
      });
      return obj;
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

// ─── Project Detection ──────────────────────────────────────────────────────

export function detectTsconfig(dir: string): string | null {
  const candidates = ['tsconfig.json', 'tsconfig.build.json'];
  for (const c of candidates) {
    if (existsSync(join(dir, c))) return c;
  }
  return null;
}

export function generateProjectId(dir: string): string {
  const hash = createHash('md5').update(resolve(dir)).digest('hex').slice(0, 12);
  return `proj_${hash}`;
}

export function detectProjectName(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    return pkg.name || basename(dir);
  } catch {
    return basename(dir);
  }
}

// ─── Commands ───────────────────────────────────────────────────────────────

export async function runInit() {
  console.log('🔧 CodeGraph Init\n');
  
  // Check Neo4j
  console.log('Checking Neo4j connection...');
  const config = getNeo4jConfig();
  const connected = await checkNeo4j();
  
  if (connected) {
    console.log(`  ✅ Neo4j is running at ${config.uri}`);
    
    // Check APOC
    try {
      const rows = await queryNeo4j('RETURN apoc.version() AS v');
      console.log(`  ✅ APOC ${rows[0]?.v || 'available'}`);
    } catch {
      console.log('  ⚠️ APOC not installed — some features may be limited');
      console.log('     Install: download APOC JAR → neo4j plugins/ → restart');
    }
    
    // Check vector index
    try {
      const rows = await queryNeo4j("SHOW INDEXES YIELD name WHERE name = 'codenode_embeddings' RETURN name");
      if (rows.length > 0) {
        console.log('  ✅ Vector index exists');
      } else {
        console.log('  ⚠️ No vector index — run `codegraph enrich` to create one');
      }
    } catch {
      console.log('  ⚠️ Could not check vector index');
    }
    
    // List projects
    const projects = await queryNeo4j('MATCH (p:Project) RETURN p.name AS name, p.projectId AS id, p.nodeCount AS nodes, p.edgeCount AS edges');
    if (projects.length > 0) {
      console.log('\n📊 Existing projects:');
      for (const p of projects) {
        console.log(`  • ${p.name} (${p.id}) — ${p.nodes || '?'} nodes, ${p.edges || '?'} edges`);
      }
    }
    
    console.log('\n✅ Ready. Run `codegraph parse <dir>` to graph a project.');
  } else {
    console.log(`  ❌ Neo4j not reachable at ${config.uri}`);
    console.log('\n  To install Neo4j natively (recommended for WSL):');
    console.log('    wget -O - https://debian.neo4j.com/neotechnology.gpg.key | sudo apt-key add -');
    console.log('    echo "deb https://debian.neo4j.com stable latest" | sudo tee /etc/apt/sources.list.d/neo4j.list');
    console.log('    sudo apt update && sudo apt install neo4j');
    console.log('    sudo neo4j start');
    console.log(`    cypher-shell -u ${config.user} -p ${config.password} "RETURN 1"`);
    console.log('\n  Or set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD env vars for a remote instance.');
  }
}

export async function runParse(dir: string, options: { tsconfig?: string; projectId?: string; name?: string; fresh?: boolean }) {
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    console.error(`❌ Directory not found: ${absDir}`);
    process.exit(1);
  }
  
  const tsconfig = options.tsconfig || detectTsconfig(absDir);
  if (!tsconfig) {
    console.error('❌ No tsconfig.json found. Create one or pass --tsconfig <path>');
    process.exit(1);
  }
  
  // Check Neo4j
  if (!await checkNeo4j()) {
    console.error('❌ Neo4j not running. Run `codegraph init` first.');
    process.exit(1);
  }

  // Auto-detect existing projectId from Neo4j if not provided
  let projectId = options.projectId;
  let isReparse = false;
  if (!projectId) {
    const existing = await queryNeo4j(
      'MATCH (p:Project) WHERE p.path = $path RETURN p.projectId AS id, p.name AS name',
      { path: absDir },
    );
    if (existing.length > 0) {
      projectId = existing[0].id;
      isReparse = true;
      console.log(`🔄 Found existing project: ${existing[0].name} (${projectId})`);
      console.log(`   Use --fresh to wipe and recreate from scratch.\n`);
    } else {
      projectId = generateProjectId(absDir);
    }
  } else {
    // Check if the provided projectId already exists
    const existing = await queryNeo4j(
      'MATCH (p:Project {projectId: $pid}) RETURN p.name AS name',
      { pid: projectId },
    );
    if (existing.length > 0) {
      isReparse = true;
      console.log(`🔄 Reparsing existing project: ${existing[0].name} (${projectId})`);
      if (!options.fresh) {
        console.log(`   Derived data will be preserved and rebuilt.\n`);
      }
    }
  }
  
  const projectName = options.name || detectProjectName(absDir);
  const freshMode = options.fresh || !isReparse;
  
  console.log(`📝 Parsing: ${absDir}`);
  console.log(`   tsconfig: ${tsconfig}`);
  console.log(`   projectId: ${projectId}`);
  console.log(`   name: ${projectName}`);
  console.log(`   mode: ${freshMode ? 'fresh (wipe + create)' : 'reparse (merge + rebuild-derived)'}\n`);
  
  // Dynamic import parser
  const { TypeScriptParser } = await import('../core/parsers/typescript-parser.js');
  const { CORE_TYPESCRIPT_SCHEMA } = await import('../core/config/schema.js');
  const { Neo4jService } = await import('../../src/storage/neo4j/neo4j.service.js');
  
  // Flatten a Neo4jNode into a flat property map safe for Neo4j SET.
  // Neo4j rejects MAP-valued properties; this extracts .properties,
  // adds top-level scalars, and JSON-stringifies any remaining objects.
  function flattenNodeForNeo4j(n: any, pid: string | undefined): Record<string, any> {
    const flat: Record<string, any> = {
      ...(n.properties ?? {}),
      projectId: pid,
    };
    // Preserve id/nodeId at top level
    if (n.id && !flat.id) flat.id = n.id;
    if (n.nodeId) flat.nodeId = n.nodeId;
    // labels array is fine (primitive array), but nested objects are not
    if (n.labels) flat.labels = n.labels;
    // Stringify any remaining MAP-valued properties
    for (const [k, v] of Object.entries(flat)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        flat[k] = JSON.stringify(v);
      }
    }
    return flat;
  }

  // Flatten edge properties: strip routing keys, stringify any MAP values
  function flattenEdgeProps(edge: any): Record<string, any> {
    const skipKeys = ['type', 'sourceId', 'targetId', 'startNodeId', 'endNodeId', 'id', 'properties'];
    // If edge has a nested properties object, use that; otherwise use the edge itself
    const raw = edge.properties ? { ...edge.properties } : { ...edge };
    const props = Object.fromEntries(
      Object.entries(raw).filter(([k]) => !skipKeys.includes(k)),
    );
    for (const [k, v] of Object.entries(props)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        props[k] = JSON.stringify(v);
      }
    }
    return props;
  }

  // Check for framework schemas
  let frameworkSchemas: any[] = [];
  const codegraphYml = join(absDir, '.codegraph.yml');
  if (existsSync(codegraphYml)) {
    console.log('   Found .codegraph.yml — loading framework config');
    // TODO: load framework schemas from yml
  }
  
  // Parse
  console.log('Parsing TypeScript files...');
  const startParse = Date.now();
  const parser = new TypeScriptParser(absDir, tsconfig, CORE_TYPESCRIPT_SCHEMA, frameworkSchemas, undefined, projectId);
  await parser.parseWorkspace();
  const { nodes, edges } = parser.exportToJson();
  const parseMs = Date.now() - startParse;
  console.log(`  ✅ Parsed ${nodes.length} nodes, ${edges.length} edges in ${parseMs}ms`);
  
  // Ingest
  console.log('Ingesting to Neo4j...');
  const startIngest = Date.now();
  const neo4jService = new Neo4jService();
  const BATCH_SIZE = 500;
  
  if (freshMode) {
    // Fresh mode: wipe everything and CREATE (original behavior)
    console.log('  🗑️  Clearing existing project data...');
    await neo4jService.run('MATCH (n {projectId: $projectId}) DETACH DELETE n', { projectId });
    
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      for (const node of batch) {
        const props = flattenNodeForNeo4j(node, projectId);
        const nodeLabels = (node as any).labels || ['CodeNode'];
        delete props.labels;
        const labelStr = nodeLabels.join(':');
        await neo4jService.run(`
          CREATE (n:${labelStr})
          SET n = $props
        `, { props });
      }
      const end = Math.min(i + BATCH_SIZE, nodes.length);
      process.stdout.write(`  Nodes ${i + 1}-${end} of ${nodes.length}\r`);
    }
    
    for (let i = 0; i < edges.length; i += BATCH_SIZE) {
      const batch = edges.slice(i, i + BATCH_SIZE);
      for (const edge of batch) {
        const srcId = (edge as any).sourceId || (edge as any).startNodeId;
        const tgtId = (edge as any).targetId || (edge as any).endNodeId;
        await neo4jService.run(`
          MATCH (s:CodeNode {id: $sourceId, projectId: $projectId})
          MATCH (t:CodeNode {id: $targetId, projectId: $projectId})
          CREATE (s)-[r:${edge.type}]->(t)
          SET r = $props
        `, { 
          sourceId: srcId, 
          targetId: tgtId, 
          projectId,
          props: flattenEdgeProps(edge),
        });
      }
    }
  } else {
    // Reparse mode: MERGE nodes, delete+recreate parser edges, preserve derived edges
    console.log('  🔄 Merging nodes (preserving derived data)...');
    
    // Delete only parser-created edges (non-derived) for this project
    await neo4jService.run(`
      MATCH (s {projectId: $projectId})-[r]->(t)
      WHERE r.derived IS NULL OR r.derived = false
      DELETE r
      RETURN count(r) AS deleted
    `, { projectId });
    
    // MERGE nodes by nodeId — update parser properties, preserve derived properties
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      for (const node of batch) {
        const props = flattenNodeForNeo4j(node, projectId);
        // Remove labels from props — they're Neo4j labels, not flat properties
        delete props.labels;
        const nodeId = props.id || (node as any).id;
        // MERGE mode: node already exists with correct labels from prior parse
        // Just update properties, don't re-apply labels (triggers constraint re-validation)
        await neo4jService.run(`
          MERGE (n:CodeNode {id: $nodeId, projectId: $projectId})
          SET n += $props
        `, { nodeId, projectId, props });
      }
      const end = Math.min(i + BATCH_SIZE, nodes.length);
      process.stdout.write(`  Nodes ${i + 1}-${end} of ${nodes.length}\r`);
    }
    console.log();
    
    // Recreate parser edges
    console.log('  🔄 Recreating parser edges...');
    for (let i = 0; i < edges.length; i += BATCH_SIZE) {
      const batch = edges.slice(i, i + BATCH_SIZE);
      for (const edge of batch) {
        const srcId = (edge as any).sourceId || (edge as any).startNodeId;
        const tgtId = (edge as any).targetId || (edge as any).endNodeId;
        await neo4jService.run(`
          MATCH (s:CodeNode {id: $sourceId, projectId: $projectId})
          MATCH (t:CodeNode {id: $targetId, projectId: $projectId})
          MERGE (s)-[r:${edge.type}]->(t)
          SET r += $props
        `, { 
          sourceId: srcId, 
          targetId: tgtId, 
          projectId,
          props: flattenEdgeProps(edge),
        });
      }
      const end = Math.min(i + BATCH_SIZE, edges.length);
      process.stdout.write(`  Edges ${i + 1}-${end} of ${edges.length}\r`);
    }
    console.log();
    
    // Remove stale nodes (in graph but not in parse output)
    const parsedNodeIds = new Set(nodes.map((n: any) => (n as any).nodeId || (n as any).id));
    const existingNodes = await queryNeo4j(
      `MATCH (n:CodeNode {projectId: $projectId})
       WHERE NOT n:Entrypoint AND NOT n:Field AND NOT n:UnresolvedReference
         AND NOT n:VerificationResult AND NOT n:AnalysisScope AND NOT n:VerificationBundle
         AND NOT n:GraphMetricsSnapshot AND NOT n:AuditCheck AND NOT n:InvariantViolation
         AND NOT n:EvaluationRun AND NOT n:MetricResult AND NOT n:TestCase
       RETURN n.nodeId AS nodeId`,
      { projectId },
    );
    const staleNodeIds = existingNodes
      .filter(n => n.nodeId && !parsedNodeIds.has(n.nodeId))
      .map(n => n.nodeId);
    
    if (staleNodeIds.length > 0) {
      console.log(`  🧹 Removing ${staleNodeIds.length} stale nodes...`);
      await neo4jService.run(
        'MATCH (n:CodeNode {projectId: $projectId}) WHERE n.nodeId IN $staleIds DETACH DELETE n',
        { projectId, staleIds: staleNodeIds },
      );
    }
    
    // Run rebuild-derived to restore derived layers
    console.log('\n  🔧 Rebuilding derived layers...');
    try {
      execSync('npm run rebuild-derived', {
        cwd: process.cwd(),
        stdio: 'inherit',
        timeout: 300_000,
      });
    } catch (err: any) {
      console.error('  ⚠️  rebuild-derived failed — run manually: npm run rebuild-derived');
    }
  }
  
  const ingestMs = Date.now() - startIngest;
  console.log(`  ✅ Ingested to Neo4j in ${ingestMs}ms`);
  
  // Create/update project node
  await neo4jService.run(`
    MERGE (p:Project {projectId: $projectId})
    SET p:CodeNode, p.name = $name, p.path = $path, p.nodeCount = $nodes, p.edgeCount = $edges,
        p.status = 'parsed', p.updatedAt = datetime()
  `, { projectId, name: projectName, path: absDir, nodes: nodes.length, edges: edges.length });
  
  if (freshMode) {
    console.log(`\n✅ Project "${projectName}" parsed. Run \`codegraph enrich ${projectId}\` next.`);
  } else {
    console.log(`\n✅ Project "${projectName}" reparsed. Derived layers rebuilt.`);
  }
}

export async function runEnrich(projectIdArg?: string) {
  if (!await checkNeo4j()) {
    console.error('❌ Neo4j not running.');
    process.exit(1);
  }
  
  // Auto-detect project if not specified
  let projectId = projectIdArg;
  if (!projectId) {
    const projects = await queryNeo4j('MATCH (p:Project) RETURN p.projectId AS id, p.name AS name');
    if (projects.length === 0) {
      console.error('❌ No projects found. Run `codegraph parse <dir>` first.');
      process.exit(1);
    } else if (projects.length === 1) {
      projectId = projects[0].id;
      console.log(`Auto-detected project: ${projects[0].name} (${projectId})`);
    } else {
      console.error('Multiple projects found. Specify one:');
      projects.forEach(p => console.error(`  ${p.id} — ${p.name}`));
      process.exit(1);
    }
  }
  
  console.log(`🔬 Enriching project: ${projectId}\n`);
  
  // Step 1: Fan metrics + base riskLevel inputs
  console.log('1/6: Computing fan metrics + base risk inputs...');
  await queryNeo4j(`
    MATCH (fn:CodeNode {projectId: $pid})
    WHERE fn.startLine IS NOT NULL
    OPTIONAL MATCH (caller)-[:CALLS]->(fn)
    WITH fn, count(DISTINCT caller) AS fanIn
    OPTIONAL MATCH (fn)-[:CALLS]->(callee)
    WITH fn, fanIn, count(DISTINCT callee) AS fanOut
    SET fn.fanInCount = fanIn, fn.fanOutCount = fanOut,
        fn.lineCount = CASE WHEN fn.endLine IS NOT NULL THEN fn.endLine - fn.startLine ELSE null END
  `, { pid: projectId });
  
  await queryNeo4j(`
    MATCH (fn:CodeNode {projectId: $pid})
    WHERE fn.fanInCount IS NOT NULL AND fn.fanOutCount IS NOT NULL
    WITH fn,
      fn.fanInCount * fn.fanOutCount * log(toFloat(coalesce(fn.lineCount, 1)) + 1.0) AS risk
    SET fn.riskLevel = risk
  `, { pid: projectId });
  console.log('  ✅ Done');
  
  // Step 2: Cross-file classification
  console.log('2/6: Classifying CALLS edges...');
  await queryNeo4j(`
    MATCH (src:CodeNode {projectId: $pid})-[r:CALLS]->(tgt:CodeNode)
    SET r.crossFile = (src.filePath <> tgt.filePath)
  `, { pid: projectId });
  console.log('  ✅ Done');
  
  // Step 3: Registration properties
  console.log('3/6: Promoting registration properties...');
  try {
    await queryNeo4j(`
      MATCH (e:Entrypoint {projectId: $pid})
      WHERE e.context IS NOT NULL
      WITH e, apoc.convert.fromJsonMap(e.context) AS ctx
      SET e.registrationKind = ctx.entrypointKind,
          e.registrationTrigger = ctx.trigger,
          e.framework = ctx.framework
    `, { pid: projectId });
    await queryNeo4j(`
      MATCH (h {projectId: $pid})-[:REGISTERED_BY]->(e:Entrypoint)
      WHERE e.registrationKind IS NOT NULL
      SET h.registrationKind = e.registrationKind,
          h.registrationTrigger = e.registrationTrigger
    `, { pid: projectId });
  } catch { /* APOC may not be available */ }
  console.log('  ✅ Done');
  
  // Step 4: File metrics
  console.log('4/6: Computing file metrics...');
  await queryNeo4j(`
    MATCH (sf:CodeNode {projectId: $pid})
    WHERE sf:SourceFile OR sf.type = 'SourceFile'
    OPTIONAL MATCH (sf)-[:CONTAINS]->(n)
    WITH sf, count(n) AS nodeCount
    OPTIONAL MATCH (sf)-[:IMPORTS]->(other)
    WITH sf, nodeCount, count(other) AS impCount
    OPTIONAL MATCH (dep)-[:IMPORTS]->(sf)
    WITH sf, nodeCount, impCount, count(dep) AS depCount
    SET sf.nodeCount = nodeCount, sf.importCount = impCount, sf.dependentCount = depCount
  `, { pid: projectId });
  console.log('  ✅ Done');
  
  // Step 5: Project node update
  console.log('5/6: Updating project node...');
  await queryNeo4j(`
    MERGE (p:Project {projectId: $pid})
    WITH p
    OPTIONAL MATCH (n:CodeNode {projectId: $pid})
    WITH p, count(n) AS nodes
    OPTIONAL MATCH (:CodeNode {projectId: $pid})-[r]->(:CodeNode {projectId: $pid})
    WITH p, nodes, count(r) AS edges
    SET p.nodeCount = nodes, p.edgeCount = edges, p.status = 'enriched', p.updatedAt = datetime()
  `, { pid: projectId });
  console.log('  ✅ Done');
  
  // Step 6: Risk tier summary
  console.log('6/6: Generating summary...');
  const tiers = await queryNeo4j(`
    MATCH (fn:CodeNode {projectId: $pid})
    WHERE fn.riskTier IS NOT NULL
    RETURN fn.riskTier AS tier, count(fn) AS count
    ORDER BY count DESC
  `, { pid: projectId });
  
  const top = await queryNeo4j(`
    MATCH (fn:CodeNode {projectId: $pid})
    WHERE fn.riskLevel IS NOT NULL AND fn.riskLevel > 0
    RETURN fn.name AS name, fn.filePath AS file, 
      round(fn.riskLevel * 10) / 10 AS risk, fn.riskTier AS tier
    ORDER BY fn.riskLevel DESC LIMIT 10
  `, { pid: projectId });
  
  console.log('\n📊 Risk Distribution:');
  for (const t of tiers) {
    const bar = '█'.repeat(Math.min(Math.ceil(t.count / 5), 40));
    console.log(`  ${t.tier.padEnd(10)} ${String(t.count).padStart(4)} ${bar}`);
  }
  
  if (top.length > 0) {
    console.log('\n🔥 Top 10 Riskiest Functions:');
    console.log(`  ${'Name'.padEnd(35)} ${'Risk'.padStart(8)} ${'Tier'.padEnd(10)} File`);
    console.log('  ' + '-'.repeat(80));
    for (const f of top) {
      const file = (f.file || '').split('/').slice(-2).join('/');
      console.log(`  ${String(f.name).padEnd(35)} ${String(f.risk).padStart(8)} ${(f.tier || '').padEnd(10)} ${file}`);
    }
  }
  
  console.log('\n✅ Enrichment complete. Run `codegraph serve` to start the MCP server.');
  console.log('   For deeper enrichment (git history, embeddings), run the individual scripts:');
  console.log('   • npx tsx temporal-coupling.ts <project>');
  console.log('   • npx tsx seed-author-ownership.ts <project>');
  console.log('   • npx tsx seed-architecture-layers.ts <project>');
  console.log('   • npx tsx embed-nodes.ts');
}

export async function runServe() {
  console.log('🚀 Starting CodeGraph MCP server...\n');
  
  if (!await checkNeo4j()) {
    console.error('❌ Neo4j not running. Run `codegraph init` first.');
    process.exit(1);
  }
  
  // Import and start the server
  const serverPath = join(__dirname, '../mcp/mcp.server.js');
  const child = spawn('node', [serverPath], {
    stdio: 'inherit',
    env: process.env,
  });
  
  child.on('exit', (code) => process.exit(code || 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

export async function runRisk(target: string) {
  if (!await checkNeo4j()) {
    console.error('❌ Neo4j not running.');
    process.exit(1);
  }
  
  // Parse target: could be "functionName" or "file.ts:functionName"
  let funcName = target;
  let filePath: string | null = null;
  
  if (target.includes(':')) {
    const parts = target.split(':');
    filePath = parts[0];
    funcName = parts[1];
  }
  
  // Find the function
  let query: string;
  let params: Record<string, any>;
  
  if (filePath) {
    query = `
      MATCH (f:CodeNode)
      WHERE f.name = $name AND f.filePath CONTAINS $filePath
      RETURN f.name AS name, f.filePath AS file, f.riskLevel AS risk, f.riskTier AS tier,
        f.fanInCount AS fanIn, f.fanOutCount AS fanOut, f.lineCount AS lines,
        f.gitChangeFrequency AS gcf, f.authorEntropy AS ae, f.projectId AS pid
    `;
    params = { name: funcName, filePath };
  } else {
    query = `
      MATCH (f:CodeNode)
      WHERE f.name = $name AND f.riskLevel IS NOT NULL
      RETURN f.name AS name, f.filePath AS file, f.riskLevel AS risk, f.riskTier AS tier,
        f.fanInCount AS fanIn, f.fanOutCount AS fanOut, f.lineCount AS lines,
        f.gitChangeFrequency AS gcf, f.authorEntropy AS ae, f.projectId AS pid
      ORDER BY f.riskLevel DESC
    `;
    params = { name: funcName };
  }
  
  const funcs = await queryNeo4j(query, params);
  
  if (funcs.length === 0) {
    console.error(`❌ Function "${funcName}" not found in graph.`);
    process.exit(1);
  }
  
  for (const f of funcs) {
    const file = (f.file || '').split('/').slice(-2).join('/');
    console.log(`\n🎯 ${f.name} (${file})`);
    console.log(`   Project: ${f.pid}`);
    console.log(`   Risk: ${(f.risk || 0).toFixed(1)} (${f.tier || 'N/A'})`);
    console.log(`   Fan-in: ${f.fanIn || 0} | Fan-out: ${f.fanOut || 0} | Lines: ${f.lines || '?'}`);
    if (f.gcf) console.log(`   Change frequency: ${f.gcf.toFixed(3)}`);
    if (f.ae) console.log(`   Author entropy: ${f.ae}`);
    
    // Blast radius
    const blast = await queryNeo4j(`
      MATCH (f:CodeNode {name: $name, projectId: $pid})<-[:CALLS*1..3]-(caller:CodeNode)
      WHERE f.filePath CONTAINS $filePath OR $filePath = ''
      RETURN DISTINCT caller.name AS name, caller.filePath AS file,
        caller.riskTier AS tier
      ORDER BY caller.name
      LIMIT 30
    `, { name: f.name, pid: f.pid, filePath: filePath || '' });
    
    if (blast.length > 0) {
      console.log(`\n   📡 Blast radius (${blast.length} transitive callers, max depth 3):`);
      for (const c of blast) {
        const cFile = (c.file || '').split('/').slice(-1)[0];
        console.log(`     ${c.name} (${cFile}) [${c.tier || '?'}]`);
      }
    }
    
    // State access
    const state = await queryNeo4j(`
      MATCH (f:CodeNode {name: $name, projectId: $pid})-[r:READS_STATE|WRITES_STATE]->(field:Field)
      WHERE f.filePath CONTAINS $filePath OR $filePath = ''
      RETURN type(r) AS access, field.name AS field
    `, { name: f.name, pid: f.pid, filePath: filePath || '' });
    
    if (state.length > 0) {
      const reads = state.filter(s => s.access === 'READS_STATE').map(s => s.field);
      const writes = state.filter(s => s.access === 'WRITES_STATE').map(s => s.field);
      if (reads.length > 0) console.log(`\n   📖 Reads: ${reads.join(', ')}`);
      if (writes.length > 0) console.log(`   ✏️ Writes: ${writes.join(', ')}`);
    }
  }
}

export async function runAnalyze(dir: string, options: { tsconfig?: string; projectId?: string; name?: string }) {
  console.log('🔍 CodeGraph Analyze — Parse + Enrich + Report\n');
  
  const absDir = resolve(dir);
  const projectId = options.projectId || generateProjectId(absDir);
  
  // Step 1: Parse
  await runParse(dir, { ...options, projectId });
  console.log('');
  
  // Step 2: Enrich
  await runEnrich(projectId);
}

export async function runRegisterProject(
  projectId: string,
  name: string,
  queryFn: typeof queryNeo4j = queryNeo4j,
) {
  const trimmedId = projectId?.trim();
  const trimmedName = name?.trim();
  if (!trimmedId || !trimmedName) {
    console.error('❌ projectId and name are required');
    process.exit(1);
  }

  const rows = await queryFn(
    `MERGE (p:Project {projectId: $projectId})
     SET p.name = $name,
         p.displayName = $name,
         p.registered = true,
         p.updatedAt = toString(datetime())
     RETURN p.projectId AS projectId, p.name AS name, coalesce(p.registered, false) AS registered`,
    { projectId: trimmedId, name: trimmedName },
  );

  const row = rows[0] || { projectId: trimmedId, name: trimmedName, registered: true };
  console.log(`✅ Registered project: ${row.projectId} (${row.name}) [registered=${row.registered}]`);
}

export async function runStatus() {
  console.log('📊 CodeGraph Status\n');
  
  const config = getNeo4jConfig();
  const connected = await checkNeo4j();
  console.log(`Neo4j: ${connected ? '✅ running' : '❌ not reachable'} (${config.uri})`);
  
  if (!connected) {
    console.log('\nRun `codegraph init` to set up Neo4j.');
    return;
  }
  
  const projects = await queryNeo4j(`
    MATCH (p:Project)
    RETURN p.name AS name, p.projectId AS id, p.path AS path,
      p.nodeCount AS nodes, p.edgeCount AS edges, p.status AS status,
      p.updatedAt AS updated
    ORDER BY p.name
  `);
  
  if (projects.length === 0) {
    console.log('\nNo projects. Run `codegraph parse <dir>` to get started.');
    return;
  }
  
  console.log(`\nProjects: ${projects.length}`);
  for (const p of projects) {
    console.log(`\n  📁 ${p.name} (${p.id})`);
    console.log(`     Path: ${p.path || '?'}`);
    console.log(`     Nodes: ${p.nodes || '?'} | Edges: ${p.edges || '?'} | Status: ${p.status || '?'}`);
    if (p.updated) console.log(`     Updated: ${p.updated}`);
    
    // Risk tier breakdown
    const tiers = await queryNeo4j(`
      MATCH (fn:CodeNode {projectId: $pid})
      WHERE fn.riskTier IS NOT NULL
      RETURN fn.riskTier AS tier, count(fn) AS count
      ORDER BY count DESC
    `, { pid: p.id });
    
    if (tiers.length > 0) {
      const tierStr = tiers.map(t => `${t.tier}: ${t.count}`).join(' | ');
      console.log(`     Risk: ${tierStr}`);
    }
  }
}

// ─── Program ────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('codegraph')
  .description('AI code knowledge graph — structural awareness for coding agents')
  .version(getVersion());

program
  .command('init')
  .description('Set up Neo4j and verify connection')
  .action(runInit);

program
  .command('parse <dir>')
  .description('Parse a TypeScript project into the graph')
  .option('--tsconfig <path>', 'Path to tsconfig.json (auto-detected)')
  .option('--project-id <id>', 'Custom project ID (auto-generated from path)')
  .option('--name <name>', 'Project name (from package.json or dir name)')
  .option('--fresh', 'Wipe all project data before parsing (destructive)')
  .action(runParse);

program
  .command('enrich [projectId]')
  .description('Run post-ingest enrichment (risk scoring, metrics)')
  .action(runEnrich);

program
  .command('serve')
  .description('Start the MCP server (30 tools)')
  .action(runServe);

program
  .command('risk <target>')
  .description('Query blast radius for a function (e.g., "createBot" or "index.ts:createBot")')
  .action(runRisk);

program
  .command('analyze <dir>')
  .description('Parse + enrich + report in one shot')
  .option('--tsconfig <path>', 'Path to tsconfig.json')
  .option('--project-id <id>', 'Custom project ID')
  .option('--name <name>', 'Project name')
  .action(runAnalyze);

program
  .command('register-project')
  .description('Register a projectId as human-approved for graph writes')
  .requiredOption('--id <projectId>', 'Project ID to register')
  .requiredOption('--name <name>', 'Human-readable project name')
  .action(async (opts: { id: string; name: string }) => {
    await runRegisterProject(opts.id, opts.name);
  });

program
  .command('status')
  .description('Show Neo4j and project status')
  .action(runStatus);

program
  .command('probe')
  .description('Run 25 architecture queries against the live graph')
  .action(async () => {
    await import('../scripts/entry/probe-architecture.js');
  });

program
  .command('diagnose')
  .description('Run 10 epistemological health checks (self-diagnosis)')
  .action(async () => {
    await import('../scripts/entry/self-diagnosis.js');
  });

export async function main() {
  try {
    await program.parseAsync();
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
