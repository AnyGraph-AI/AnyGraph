#!/usr/bin/env npx tsx
/**
 * Phase 2.3: Edit Simulation (Delta Graph)
 * 
 * Agent proposes a change → system shows what the graph looks like
 * AFTER the change, WITHOUT applying it. Shows:
 * - New CALLS added
 * - CALLS removed  
 * - Exports changed (added/removed)
 * - Functions added/removed/renamed
 * - Affected callers (broken edges)
 * - Risk assessment of the change
 * 
 * Usage:
 *   npx tsx edit-simulation.ts <filePath> <modifiedContent|diffFile>
 * 
 * Or programmatic:
 *   import { simulateEdit } from './edit-simulation.js';
 *   const result = await simulateEdit(filePath, newContent, projectId);
 */
import { TypeScriptParser } from '../../../src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from '../../../src/core/config/schema.js';
import neo4j from 'neo4j-driver';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { basename, dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

interface GraphNode {
  name: string;
  type: string;
  isExported: boolean;
  startLine?: number;
  endLine?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  conditional?: boolean;
  isAsync?: boolean;
}

interface SimulationResult {
  file: string;
  nodesAdded: GraphNode[];
  nodesRemoved: GraphNode[];
  nodesModified: { name: string; changes: string[] }[];
  callsAdded: GraphEdge[];
  callsRemoved: GraphEdge[];
  exportsAdded: string[];
  exportsRemoved: string[];
  brokenCallers: { caller: string; callerFile: string; removedTarget: string }[];
  riskAssessment: {
    changeScope: 'SAFE' | 'CAUTION' | 'DANGEROUS' | 'CRITICAL';
    reason: string;
    affectedFiles: number;
    brokenEdges: number;
  };
}

const PROJECTS: Record<string, { path: string; id: string }> = {
  codegraph: {
    path: '/home/jonathan/.openclaw/workspace/codegraph/',
    id: 'proj_c0d3e9a1f200',
  },
  godspeed: {
    path: '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/',
    id: 'proj_60d5feed0001',
  },
};

/**
 * Get current graph state for a file from Neo4j
 */
async function getCurrentGraphState(filePath: string, projectId: string, session: any) {
  // Get all nodes in this file
  const nodesResult = await session.run(`
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(n)
    WHERE sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath
    RETURN n.name AS name, labels(n) AS labels, n.isExported AS isExported,
           n.startLine AS startLine, n.endLine AS endLine, n.id AS id
  `, { pid: projectId, fileName: basename(filePath), filePath });

  const currentNodes: (GraphNode & { id: string })[] = nodesResult.records.map((r: any) => ({
    name: r.get('name'),
    type: r.get('labels').filter((l: string) => !['CodeNode', 'TypeScript', 'Embedded'].includes(l))[0] || 'Unknown',
    isExported: r.get('isExported') ?? false,
    startLine: r.get('startLine')?.toNumber?.() ?? r.get('startLine'),
    endLine: r.get('endLine')?.toNumber?.() ?? r.get('endLine'),
    id: r.get('id'),
  }));

  // Get all outgoing CALLS from nodes in this file
  const callsResult = await session.run(`
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(caller)-[r:CALLS]->(callee)
    WHERE sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath
    RETURN caller.name AS source, callee.name AS target, 
           r.conditional AS conditional, r.isAsync AS isAsync
  `, { pid: projectId, fileName: basename(filePath), filePath });

  const currentCalls: GraphEdge[] = callsResult.records.map((r: any) => ({
    source: r.get('source'),
    target: r.get('target'),
    type: 'CALLS',
    conditional: r.get('conditional'),
    isAsync: r.get('isAsync'),
  }));

  // Get external callers INTO this file's functions (for broken edge detection)
  const externalCallersResult = await session.run(`
    MATCH (caller)-[r:CALLS]->(callee)
    MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(callee)
    WHERE (sf.filePath ENDS WITH $fileName OR sf.filePath = $filePath)
    AND NOT (sf)-[:CONTAINS]->(caller)
    RETURN caller.name AS caller, caller.filePath AS callerFile, callee.name AS target
  `, { pid: projectId, fileName: basename(filePath), filePath });

  const externalCallers = externalCallersResult.records.map((r: any) => ({
    caller: r.get('caller'),
    callerFile: r.get('callerFile'),
    target: r.get('target'),
  }));

  return { currentNodes, currentCalls, externalCallers };
}

/**
 * Parse modified content with ts-morph to get new graph state
 */
async function parseModifiedContent(filePath: string, content: string, projectPath: string, projectId: string) {
  // Write to a temp file (ts-morph needs a real file)
  const tempPath = join(dirname(filePath), `.codegraph-sim-${basename(filePath)}`);
  const originalContent = readFileSync(filePath, 'utf-8');
  
  try {
    // Temporarily replace the file
    writeFileSync(filePath, content);
    
    const parser = new TypeScriptParser(
      projectPath, 'tsconfig.json', CORE_TYPESCRIPT_SCHEMA,
      [], undefined, projectId,
    );
    const result = await (parser as any).parseChunk([filePath]);
    
    // Restore original
    writeFileSync(filePath, originalContent);
    
    return result;
  } catch (err) {
    // Always restore
    writeFileSync(filePath, originalContent);
    throw err;
  }
}

/**
 * Simulate an edit and compute the graph delta
 */
export async function simulateEdit(
  filePath: string,
  newContent: string,
  projectId: string,
  projectPath: string,
): Promise<SimulationResult> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );
  const session = driver.session();

  try {
    // 1. Get current state from graph
    const { currentNodes, currentCalls, externalCallers } = 
      await getCurrentGraphState(filePath, projectId, session);

    // 2. Parse modified content
    const parseResult = await parseModifiedContent(filePath, newContent, projectPath, projectId);

    // 3. Extract new nodes and calls from parse result
    const newNodes: GraphNode[] = (parseResult.nodes || [])
      .filter((n: any) => n.properties?.filePath?.endsWith(basename(filePath)))
      .map((n: any) => ({
        name: n.properties.name,
        type: n.labels?.filter((l: string) => l !== 'CodeNode' && l !== 'TypeScript')[0] || 'Unknown',
        isExported: n.properties.isExported ?? false,
        startLine: n.properties.startLine,
        endLine: n.properties.endLine,
      }));

    const newCalls: GraphEdge[] = (parseResult.edges || [])
      .filter((e: any) => e.type === 'CALLS')
      .map((e: any) => {
        // Resolve source/target names from node IDs
        const srcNode = (parseResult.nodes || []).find((n: any) => n.properties?.id === (e.startNodeId || e.sourceId));
        const tgtNode = (parseResult.nodes || []).find((n: any) => n.properties?.id === (e.endNodeId || e.targetId));
        return {
          source: srcNode?.properties?.name || e.startNodeId || e.sourceId,
          target: tgtNode?.properties?.name || e.endNodeId || e.targetId,
          type: 'CALLS',
          conditional: e.properties?.conditional,
          isAsync: e.properties?.isAsync,
        };
      });

    // 4. Compute deltas
    const currentNodeNames = new Set(currentNodes.map(n => `${n.type}:${n.name}`));
    const newNodeNames = new Set(newNodes.map(n => `${n.type}:${n.name}`));

    const nodesAdded = newNodes.filter(n => !currentNodeNames.has(`${n.type}:${n.name}`));
    const nodesRemoved = currentNodes.filter(n => !newNodeNames.has(`${n.type}:${n.name}`));

    // Modified nodes: same name but different line ranges
    const nodesModified: { name: string; changes: string[] }[] = [];
    for (const newNode of newNodes) {
      const oldNode = currentNodes.find(n => n.name === newNode.name && n.type === newNode.type);
      if (oldNode) {
        const changes: string[] = [];
        if (oldNode.isExported !== newNode.isExported) {
          changes.push(`export: ${oldNode.isExported} → ${newNode.isExported}`);
        }
        if (oldNode.startLine !== newNode.startLine || oldNode.endLine !== newNode.endLine) {
          changes.push(`lines: ${oldNode.startLine}-${oldNode.endLine} → ${newNode.startLine}-${newNode.endLine}`);
        }
        if (changes.length > 0) {
          nodesModified.push({ name: newNode.name, changes });
        }
      }
    }

    // CALLS diff
    const currentCallKeys = new Set(currentCalls.map(c => `${c.source}→${c.target}`));
    const newCallKeys = new Set(newCalls.map(c => `${c.source}→${c.target}`));

    const callsAdded = newCalls.filter(c => !currentCallKeys.has(`${c.source}→${c.target}`));
    const callsRemoved = currentCalls.filter(c => !newCallKeys.has(`${c.source}→${c.target}`));

    // Exports diff
    const currentExports = new Set(currentNodes.filter(n => n.isExported).map(n => n.name));
    const newExports = new Set(newNodes.filter(n => n.isExported).map(n => n.name));

    const exportsAdded = [...newExports].filter(e => !currentExports.has(e));
    const exportsRemoved = [...currentExports].filter(e => !newExports.has(e));

    // Broken callers: external functions that call something we removed
    const removedNodeNames = new Set(nodesRemoved.map(n => n.name));
    const removedExportNames = new Set(exportsRemoved);
    const brokenCallers = externalCallers.filter(ec => 
      removedNodeNames.has(ec.target) || removedExportNames.has(ec.target)
    );

    // 5. Risk assessment
    let changeScope: SimulationResult['riskAssessment']['changeScope'] = 'SAFE';
    let reason = 'No external impact';

    const affectedFilesSet = new Set(brokenCallers.map(bc => bc.callerFile));

    if (brokenCallers.length > 0) {
      changeScope = 'CRITICAL';
      reason = `${brokenCallers.length} external callers will break across ${affectedFilesSet.size} files`;
    } else if (exportsRemoved.length > 0) {
      changeScope = 'DANGEROUS';
      reason = `${exportsRemoved.length} exports removed — check if anything external depends on them`;
    } else if (nodesRemoved.length > 0 || callsRemoved.length > 5) {
      changeScope = 'CAUTION';
      reason = `Structural changes: ${nodesRemoved.length} nodes removed, ${callsRemoved.length} calls removed`;
    }

    return {
      file: filePath,
      nodesAdded,
      nodesRemoved,
      nodesModified,
      callsAdded,
      callsRemoved,
      exportsAdded,
      exportsRemoved,
      brokenCallers,
      riskAssessment: {
        changeScope,
        reason,
        affectedFiles: affectedFilesSet.size,
        brokenEdges: brokenCallers.length,
      },
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function printResult(result: SimulationResult) {
  const { riskAssessment: ra } = result;
  const icon = { SAFE: '✅', CAUTION: '⚠️', DANGEROUS: '🔶', CRITICAL: '🔴' }[ra.changeScope];
  
  console.log(`\n${icon} EDIT SIMULATION: ${ra.changeScope}`);
  console.log(`   ${ra.reason}`);
  console.log(`   File: ${result.file}\n`);

  if (result.nodesAdded.length > 0) {
    console.log(`  ➕ Nodes added (${result.nodesAdded.length}):`);
    for (const n of result.nodesAdded) {
      console.log(`     + ${n.type} ${n.name}${n.isExported ? ' (exported)' : ''}`);
    }
  }

  if (result.nodesRemoved.length > 0) {
    console.log(`  ➖ Nodes removed (${result.nodesRemoved.length}):`);
    for (const n of result.nodesRemoved) {
      console.log(`     - ${n.type} ${n.name}${n.isExported ? ' (exported)' : ''}`);
    }
  }

  if (result.nodesModified.length > 0) {
    console.log(`  ✏️  Nodes modified (${result.nodesModified.length}):`);
    for (const n of result.nodesModified) {
      console.log(`     ~ ${n.name}: ${n.changes.join(', ')}`);
    }
  }

  if (result.callsAdded.length > 0) {
    console.log(`  📞 Calls added (${result.callsAdded.length}):`);
    for (const c of result.callsAdded.slice(0, 15)) {
      console.log(`     + ${c.source} → ${c.target}`);
    }
    if (result.callsAdded.length > 15) {
      console.log(`     ... and ${result.callsAdded.length - 15} more`);
    }
  }

  if (result.callsRemoved.length > 0) {
    console.log(`  ❌ Calls removed (${result.callsRemoved.length}):`);
    for (const c of result.callsRemoved.slice(0, 15)) {
      console.log(`     - ${c.source} → ${c.target}`);
    }
    if (result.callsRemoved.length > 15) {
      console.log(`     ... and ${result.callsRemoved.length - 15} more`);
    }
  }

  if (result.exportsAdded.length > 0) {
    console.log(`  📤 Exports added: ${result.exportsAdded.join(', ')}`);
  }

  if (result.exportsRemoved.length > 0) {
    console.log(`  📥 Exports removed: ${result.exportsRemoved.join(', ')}`);
  }

  if (result.brokenCallers.length > 0) {
    console.log(`  💥 BROKEN CALLERS (${result.brokenCallers.length}):`);
    for (const bc of result.brokenCallers) {
      console.log(`     💥 ${bc.caller} (${bc.callerFile}) calls removed ${bc.removedTarget}`);
    }
  }

  console.log('');
}

// CLI mode
export async function main() {
  if (process.argv.length < 4) {
    console.log('Usage: npx tsx edit-simulation.ts <filePath> <modifiedContentFile>');
    console.log('');
    console.log('The modified content file should contain the full new content of the file.');
    console.log('The script will compare it against the current graph state.');
    console.log('');
    console.log('Example: npx tsx edit-simulation.ts src/constants.ts modified-constants.ts');
    
    // Demo mode: simulate removing an export from codegraph constants
    console.log('\n--- DEMO MODE ---');
    const demoFile = '/home/jonathan/.openclaw/workspace/codegraph/src/constants.ts';
    const originalContent = readFileSync(demoFile, 'utf-8');
    
    // Simulate: add a new exported function and remove one line
    const modifiedContent = originalContent + '\n\nexport function newUtilityFunction() {\n  return 42;\n}\n';
    
    console.log(`Simulating: add newUtilityFunction() to ${basename(demoFile)}`);
    const result = await simulateEdit(
      demoFile, modifiedContent,
      'proj_c0d3e9a1f200',
      '/home/jonathan/.openclaw/workspace/codegraph/'
    );
    printResult(result);
    return;
  }

  const filePath = process.argv[2];
  const modifiedFile = process.argv[3];
  const newContent = readFileSync(modifiedFile, 'utf-8');

  // Auto-detect project
  let projectId = 'proj_c0d3e9a1f200';
  let projectPath = '/home/jonathan/.openclaw/workspace/codegraph/';
  
  for (const [, proj] of Object.entries(PROJECTS)) {
    if (filePath.startsWith(proj.path) || filePath.includes('GodSpeed')) {
      projectId = proj.id;
      projectPath = proj.path;
      break;
    }
  }

  const result = await simulateEdit(filePath, newContent, projectId, projectPath);
  printResult(result);
}

// Guard: only run when executed directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
