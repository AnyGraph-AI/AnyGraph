/**
 * Test script: Parse GodSpeed through the fork's parser (no Neo4j required)
 * Outputs node/edge counts and samples for comparison with spike (214 nodes, 5,161 edges)
 */
import { TypeScriptParser } from './src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from './src/core/config/schema.js';
import { GRAMMY_FRAMEWORK_SCHEMA } from './src/core/config/grammy-framework-schema.js';
import fs from 'fs';

const GODSPEED_PATH = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/';

async function main() {
  console.log('=== CodeGraph Fork Parser Test: GodSpeed ===\n');
  console.log(`Target: ${GODSPEED_PATH}`);
  
  // Create parser WITH Grammy framework schema
  const parser = new TypeScriptParser(
    GODSPEED_PATH,
    'tsconfig.json',
    CORE_TYPESCRIPT_SCHEMA,
    [GRAMMY_FRAMEWORK_SCHEMA], // Grammy framework schema for bot handler detection
    undefined,
    undefined,
    true // lazyLoad for large projects
  );

  // Discover source files, excluding src/src/ duplicate directory
  let files = await parser.discoverSourceFiles();
  const beforeFilter = files.length;
  files = files.filter(f => !f.includes('/src/src/'));
  console.log(`\nDiscovered ${beforeFilter} files, filtered to ${files.length} (excluded src/src/ duplicates):`);
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

  // Check for Entrypoint nodes and REGISTERED_BY edges
  const entrypoints = result.nodes.filter(n => n.labels?.includes('Entrypoint'));
  console.log(`\n--- Entrypoint Nodes (${entrypoints.length}) ---`);
  for (const ep of entrypoints.slice(0, 30)) {
    console.log(`  ${ep.properties?.name} [${ep.properties?.context?.entrypointKind}] trigger=${ep.properties?.context?.trigger}`);
  }

  const handlers = result.nodes.filter(n => n.properties?.context?.registrationKind);
  console.log(`\n--- Callback Handlers (${handlers.length}) ---`);
  for (const h of handlers.slice(0, 30)) {
    console.log(`  ${h.properties?.name} [${h.properties?.context?.registrationKind}] trigger=${h.properties?.context?.registrationTrigger}`);
  }

  const registeredByEdges = allEdges.filter(e => e.type === 'REGISTERED_BY');
  console.log(`\n--- REGISTERED_BY Edges: ${registeredByEdges.length} ---`);

  // Check for semantic types
  const semanticTypes = new Map<string, number>();
  for (const node of result.nodes) {
    const st = node.properties?.semanticType;
    if (st) semanticTypes.set(st, (semanticTypes.get(st) || 0) + 1);
  }
  if (semanticTypes.size > 0) {
    console.log('\n--- Semantic Types ---');
    for (const [type, count] of [...semanticTypes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // === INVARIANT CHECKS (GPT review requirements) ===
  console.log('\n=== INVARIANT CHECKS ===');
  
  // Check 1: Entrypoint/handler mismatch
  const regEdges = allEdges.filter(e => e.type === 'REGISTERED_BY');
  const epIdsWithHandler = new Set(regEdges.map(e => e.endNodeId));
  const handlerIdsWithEp = new Set(regEdges.map(e => e.startNodeId));
  
  const orphanEps = entrypoints.filter(ep => !epIdsWithHandler.has(ep.properties?.id));
  const orphanHandlers = handlers.filter(h => !handlerIdsWithEp.has(h.properties?.id));
  
  console.log(`\n1. Entrypoint/Handler matching:`);
  console.log(`   Entrypoints: ${entrypoints.length}, Handlers: ${handlers.length}`);
  console.log(`   Orphan entrypoints (no handler): ${orphanEps.length}`);
  for (const ep of orphanEps) {
    console.log(`     ${ep.properties?.name} ctx=${JSON.stringify(ep.properties?.context)}`);
  }
  console.log(`   Orphan handlers (no entrypoint): ${orphanHandlers.length}`);
  for (const h of orphanHandlers) {
    console.log(`     ${h.properties?.name} ctx=${JSON.stringify(h.properties?.context)}`);
  }

  // Check 2: Callback body CALLS belong to handler, not createBot
  const createBotNode = result.nodes.find(n => n.properties?.name === 'createBot' && n.properties?.semanticType === 'BotFactory');
  if (createBotNode) {
    const createBotCalls = allEdges.filter(e => e.type === 'CALLS' && e.startNodeId === createBotNode.properties?.id);
    const handlerIds = new Set(handlers.map(h => h.properties?.id));
    const handlerCalls = allEdges.filter(e => e.type === 'CALLS' && handlerIds.has(e.startNodeId));
    
    console.log(`\n2. CALLS ownership:`);
    console.log(`   createBot CALLS: ${createBotCalls.length}`);
    console.log(`   Handler CALLS (sum of all handlers): ${handlerCalls.length}`);
    console.log(`   Total CALLS: ${allEdges.filter(e => e.type === 'CALLS').length}`);
    
    // Sample: show a specific handler's calls
    const startHandler = handlers.find(h => h.properties?.context?.registrationTrigger === 'start');
    if (startHandler) {
      const startCalls = allEdges.filter(e => e.type === 'CALLS' && e.startNodeId === startHandler.properties?.id);
      console.log(`\n   /start handler CALLS (${startCalls.length}):`);
      for (const c of startCalls.slice(0, 10)) {
        const target = result.nodes.find(n => n.properties?.id === c.endNodeId);
        console.log(`     → ${target?.properties?.name || c.endNodeId}`);
      }
    }
  }

  // Check 3: No REGISTERED_BY Cartesian explosion
  console.log(`\n3. REGISTERED_BY sanity:`);
  console.log(`   Total REGISTERED_BY edges: ${regEdges.length}`);
  console.log(`   Expected max (1 per handler): ${handlers.length}`);
  console.log(`   Ratio: ${(regEdges.length / Math.max(handlers.length, 1)).toFixed(2)} (should be ~1.0)`);
  
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
