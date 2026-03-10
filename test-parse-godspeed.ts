/**
 * Test script: Parse GodSpeed through the fork's parser (no Neo4j required)
 * Outputs node/edge counts and samples for comparison with spike (214 nodes, 5,161 edges)
 */
import { TypeScriptParser } from './src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from './src/core/config/schema.js';
import fs from 'fs';

const GODSPEED_PATH = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/';

async function main() {
  console.log('=== CodeGraph Fork Parser Test: GodSpeed ===\n');
  console.log(`Target: ${GODSPEED_PATH}`);
  
  // Create parser with no framework schemas (raw parse first)
  const parser = new TypeScriptParser(
    GODSPEED_PATH,
    'tsconfig.json',
    CORE_TYPESCRIPT_SCHEMA,
    [], // No framework schemas yet
    undefined,
    undefined,
    true // lazyLoad for large projects
  );

  // Discover source files
  const files = await parser.discoverSourceFiles();
  console.log(`\nDiscovered ${files.length} source files:`);
  files.forEach(f => console.log(`  ${f}`));

  // Parse all files
  console.log('\nParsing...');
  const startTime = Date.now();
  const result = await parser.parseChunk(files);
  
  // Resolve deferred edges (cross-file)
  const deferredEdges = await parser.resolveDeferredEdges();
  const allEdges = [...result.edges, ...deferredEdges];
  
  const elapsed = Date.now() - startTime;
  
  console.log(`\nParse complete in ${elapsed}ms`);
  console.log(`  Nodes: ${result.nodes.length}`);
  console.log(`  Edges (direct): ${result.edges.length}`);
  console.log(`  Edges (deferred/cross-file): ${deferredEdges.length}`);
  console.log(`  Total edges: ${allEdges.length}`);

  // Node type breakdown
  const nodeTypes = new Map<string, number>();
  for (const node of result.nodes) {
    const type = node.labels?.[0] || node.properties?.coreType || 'Unknown';
    nodeTypes.set(type, (nodeTypes.get(type) || 0) + 1);
  }
  console.log('\n--- Node Types ---');
  for (const [type, count] of [...nodeTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Edge type breakdown
  const edgeTypes = new Map<string, number>();
  for (const edge of allEdges) {
    const type = edge.type || 'Unknown';
    edgeTypes.set(type, (edgeTypes.get(type) || 0) + 1);
  }
  console.log('\n--- Edge Types ---');
  for (const [type, count] of [...edgeTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Sample some function nodes
  const functionNodes = result.nodes.filter(n => 
    n.properties?.coreType === 'FunctionDeclaration' || 
    n.properties?.coreType === 'MethodDeclaration'
  );
  console.log(`\n--- Sample Function Nodes (first 20) ---`);
  for (const fn of functionNodes.slice(0, 20)) {
    console.log(`  ${fn.properties?.name} [${fn.properties?.coreType}] @ ${fn.properties?.filePath || ''}`);
  }

  // Check createBot specifically
  const createBot = result.nodes.find(n => n.properties?.name === 'createBot');
  if (createBot) {
    console.log(`\n--- createBot Details ---`);
    console.log(JSON.stringify(createBot.properties, null, 2));
    
    // Count CALLS edges from createBot
    const createBotCalls = allEdges.filter(e => 
      e.type === 'CALLS' && e.startNodeId === createBot.properties?.id
    );
    console.log(`\n  CALLS edges from createBot: ${createBotCalls.length}`);
    
    // Sample some call targets
    console.log('  Sample targets (first 20):');
    for (const call of createBotCalls.slice(0, 20)) {
      console.log(`    → ${call.endNodeId} ${call.properties?.callContext ? JSON.stringify(call.properties.callContext) : ''}`);
    }
  } else {
    console.log('\n⚠️ createBot not found in parsed nodes!');
  }

  // Write full output for analysis
  const output = {
    summary: {
      files: files.length,
      nodes: result.nodes.length,
      edges: allEdges.length,
      parseTimeMs: elapsed,
      spike_comparison: {
        spike_nodes: 214,
        spike_edges: 5161
      }
    },
    nodeTypes: Object.fromEntries(nodeTypes),
    edgeTypes: Object.fromEntries(edgeTypes),
    nodes: result.nodes.map(n => ({
      id: n.properties?.id,
      name: n.properties?.name,
      coreType: n.properties?.coreType,
      filePath: n.properties?.filePath,
      startLine: n.properties?.startLine,
      endLine: n.properties?.endLine,
    })),
  };
  
  fs.writeFileSync('godspeed-fork-parse.json', JSON.stringify(output, null, 2));
  console.log('\n✅ Full output written to godspeed-fork-parse.json');
}

main().catch(err => {
  console.error('Parse failed:', err);
  process.exit(1);
});
