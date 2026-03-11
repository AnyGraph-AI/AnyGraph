/**
 * Completeness verification: ts-morph AST vs Neo4j graph
 * 
 * Walks every declaration in GodSpeed via ts-morph (same as the parser),
 * then queries Neo4j for what's actually in the graph.
 * Reports any declarations that exist in source but NOT in the graph.
 * 
 * Usage: npx tsx verify-completeness.ts
 */
import { Project, Node, SyntaxKind } from 'ts-morph';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const GODSPEED_ROOT = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed';

interface Declaration {
  kind: string;
  name: string;
  file: string;       // relative path
  line: number;
  exported: boolean;
  parent?: string;     // enclosing function/class name
}

async function main() {
  // === PHASE 1: Extract all declarations from source via ts-morph ===
  console.log('=== Phase 1: Walking source AST with ts-morph ===\n');
  
  const project = new Project({
    compilerOptions: { allowJs: true, target: 99, module: 99 },
  });
  
  // Add only .ts files in src/ (exclude .d.ts)
  project.addSourceFilesAtPaths(path.join(GODSPEED_ROOT, 'src/**/*.ts'));
  
  const sourceDecls: Declaration[] = [];
  
  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    if (filePath.endsWith('.d.ts')) continue;
    const relPath = path.relative(GODSPEED_ROOT, filePath);
    
    // Top-level function declarations
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name) continue; // skip anonymous
      sourceDecls.push({
        kind: 'Function',
        name,
        file: relPath,
        line: fn.getStartLineNumber(),
        exported: fn.isExported(),
      });
      
      // Inner function declarations (named functions inside this function)
      fn.forEachDescendant(node => {
        if (Node.isFunctionDeclaration(node) && node !== fn) {
          const innerName = node.getName();
          if (innerName) {
            sourceDecls.push({
              kind: 'InnerFunction',
              name: innerName,
              file: relPath,
              line: node.getStartLineNumber(),
              exported: false,
              parent: name,
            });
            
            // Go one more level — inner functions inside inner functions
            node.forEachDescendant(inner2 => {
              if (Node.isFunctionDeclaration(inner2) && inner2 !== node) {
                const inner2Name = inner2.getName();
                if (inner2Name) {
                  sourceDecls.push({
                    kind: 'InnerFunction',
                    name: inner2Name,
                    file: relPath,
                    line: inner2.getStartLineNumber(),
                    exported: false,
                    parent: innerName,
                  });
                }
              }
            });
          }
        }
      });
    }
    
    // Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName();
      if (!name) continue;
      sourceDecls.push({
        kind: 'Class',
        name,
        file: relPath,
        line: cls.getStartLineNumber(),
        exported: cls.isExported(),
      });
      
      // Methods
      for (const method of cls.getMethods()) {
        sourceDecls.push({
          kind: 'Method',
          name: method.getName(),
          file: relPath,
          line: method.getStartLineNumber(),
          exported: cls.isExported(),
          parent: name,
        });
      }
      
      // Constructor
      for (const ctor of cls.getConstructors()) {
        sourceDecls.push({
          kind: 'Constructor',
          name: 'constructor',
          file: relPath,
          line: ctor.getStartLineNumber(),
          exported: cls.isExported(),
          parent: name,
        });
      }
      
      // Properties (class members)
      for (const prop of cls.getProperties()) {
        sourceDecls.push({
          kind: 'Property',
          name: prop.getName(),
          file: relPath,
          line: prop.getStartLineNumber(),
          exported: cls.isExported(),
          parent: name,
        });
      }
    }
    
    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      sourceDecls.push({
        kind: 'Interface',
        name,
        file: relPath,
        line: iface.getStartLineNumber(),
        exported: iface.isExported(),
      });
    }
    
    // Type aliases
    for (const ta of sourceFile.getTypeAliases()) {
      sourceDecls.push({
        kind: 'TypeAlias',
        name: ta.getName(),
        file: relPath,
        line: ta.getStartLineNumber(),
        exported: ta.isExported(),
      });
    }
    
    // Variables
    for (const vs of sourceFile.getVariableStatements()) {
      const isExported = vs.isExported();
      for (const vd of vs.getDeclarations()) {
        sourceDecls.push({
          kind: 'Variable',
          name: vd.getName(),
          file: relPath,
          line: vd.getStartLineNumber(),
          exported: isExported,
        });
      }
    }
    
    // Enums
    for (const en of sourceFile.getEnums()) {
      sourceDecls.push({
        kind: 'Enum',
        name: en.getName(),
        file: relPath,
        line: en.getStartLineNumber(),
        exported: en.isExported(),
      });
    }
  }
  
  // Count by kind
  const kindCounts: Record<string, number> = {};
  for (const d of sourceDecls) {
    kindCounts[d.kind] = (kindCounts[d.kind] || 0) + 1;
  }
  console.log('Source declarations by kind:');
  for (const [kind, count] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind}: ${count}`);
  }
  console.log(`  TOTAL: ${sourceDecls.length}\n`);
  
  // === PHASE 2: Query Neo4j for all graph nodes ===
  console.log('=== Phase 2: Querying Neo4j graph ===\n');
  
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph'
    )
  );
  const session = driver.session();
  
  try {
    // Get all declaration nodes from graph
    const result = await session.run(`
      MATCH (n)
      WHERE n.filePath IS NOT NULL AND n.name IS NOT NULL
      AND NOT n:Entrypoint
      AND NOT n:Parameter
      AND NOT n:Import
      AND NOT n:SourceFile
      AND NOT n:Field
      RETURN n.name AS name, 
             labels(n) AS labels,
             n.filePath AS filePath,
             n.startLine AS startLine,
             n.isExported AS isExported,
             n.isInnerFunction AS isInner,
             n.coreType AS coreType
      ORDER BY n.filePath, n.startLine
    `);
    
    interface GraphNode {
      name: string;
      labels: string[];
      filePath: string;
      startLine: number;
      isExported: boolean;
      isInner: boolean;
      coreType: string;
    }
    
    const graphNodes: GraphNode[] = result.records.map(r => ({
      name: r.get('name'),
      labels: r.get('labels'),
      filePath: r.get('filePath'),
      startLine: typeof r.get('startLine') === 'object' ? r.get('startLine').toNumber() : r.get('startLine'),
      isExported: r.get('isExported') ?? false,
      isInner: r.get('isInner') ?? false,
      coreType: r.get('coreType'),
    }));
    
    // Count graph nodes by type
    const graphKindCounts: Record<string, number> = {};
    for (const n of graphNodes) {
      const kind = n.isInner ? 'InnerFunction' : 
                   n.labels.includes('Function') ? 'Function' :
                   n.labels.includes('Class') ? 'Class' :
                   n.labels.includes('Method') ? 'Method' :
                   n.labels.includes('Interface') ? 'Interface' :
                   n.labels.includes('TypeAlias') ? 'TypeAlias' :
                   n.labels.includes('Variable') ? 'Variable' :
                   n.labels.includes('Property') ? 'Property' :
                   n.labels.includes('Constructor') ? 'Constructor' :
                   n.labels.join('/');
      graphKindCounts[kind] = (graphKindCounts[kind] || 0) + 1;
    }
    console.log('Graph nodes by kind:');
    for (const [kind, count] of Object.entries(graphKindCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${kind}: ${count}`);
    }
    console.log(`  TOTAL: ${graphNodes.length}\n`);
    
    // === PHASE 3: Cross-reference — find MISSING declarations ===
    console.log('=== Phase 3: Cross-reference (source → graph) ===\n');
    
    // Build a lookup set from graph: "name|file|startLine"
    const graphSet = new Set<string>();
    const graphByNameFile = new Map<string, GraphNode[]>();
    for (const n of graphNodes) {
      const relFile = path.relative(GODSPEED_ROOT, n.filePath);
      graphSet.add(`${n.name}|${relFile}|${n.startLine}`);
      const key = `${n.name}|${relFile}`;
      if (!graphByNameFile.has(key)) graphByNameFile.set(key, []);
      graphByNameFile.get(key)!.push(n);
    }
    
    const missing: Declaration[] = [];
    const matched: Declaration[] = [];
    
    for (const decl of sourceDecls) {
      // Try exact match first (name + file + line)
      const exactKey = `${decl.name}|${decl.file}|${decl.line}`;
      if (graphSet.has(exactKey)) {
        matched.push(decl);
        continue;
      }
      
      // Try fuzzy match (name + file, any line — parser might offset lines)
      const fuzzyKey = `${decl.name}|${decl.file}`;
      if (graphByNameFile.has(fuzzyKey)) {
        matched.push(decl);
        continue;
      }
      
      missing.push(decl);
    }
    
    if (missing.length === 0) {
      console.log('✅ PERFECT MATCH — Every source declaration has a graph node.\n');
    } else {
      console.log(`❌ ${missing.length} MISSING declarations (in source, NOT in graph):\n`);
      for (const d of missing) {
        console.log(`  ${d.kind} ${d.name} @ ${d.file}:${d.line}${d.parent ? ` (inside ${d.parent})` : ''}${d.exported ? ' [exported]' : ''}`);
      }
      console.log('');
    }
    
    // === PHASE 4: Reverse check — graph nodes NOT in source ===
    console.log('=== Phase 4: Reverse check (graph → source) ===\n');
    
    const sourceSet = new Set<string>();
    const sourceByNameFile = new Map<string, Declaration[]>();
    for (const d of sourceDecls) {
      sourceSet.add(`${d.name}|${d.file}|${d.line}`);
      const key = `${d.name}|${d.file}`;
      if (!sourceByNameFile.has(key)) sourceByNameFile.set(key, []);
      sourceByNameFile.get(key)!.push(d);
    }
    
    const orphanGraphNodes: GraphNode[] = [];
    for (const n of graphNodes) {
      const relFile = path.relative(GODSPEED_ROOT, n.filePath);
      const exactKey = `${n.name}|${relFile}|${n.startLine}`;
      const fuzzyKey = `${n.name}|${relFile}`;
      if (!sourceSet.has(exactKey) && !sourceByNameFile.has(fuzzyKey)) {
        orphanGraphNodes.push(n);
      }
    }
    
    if (orphanGraphNodes.length === 0) {
      console.log('✅ No orphan graph nodes — every graph node maps to a source declaration.\n');
    } else {
      console.log(`⚠️  ${orphanGraphNodes.length} graph nodes NOT found in source declarations:\n`);
      for (const n of orphanGraphNodes) {
        const relFile = path.relative(GODSPEED_ROOT, n.filePath);
        console.log(`  ${n.coreType} ${n.name} @ ${relFile}:${n.startLine} ${n.labels.join(',')}`);
      }
      console.log('');
    }
    
    // === SUMMARY ===
    console.log('=== SUMMARY ===');
    console.log(`Source declarations: ${sourceDecls.length}`);
    console.log(`Graph nodes:         ${graphNodes.length}`);
    console.log(`Matched:             ${matched.length}`);
    console.log(`Missing from graph:  ${missing.length}`);
    console.log(`Orphan in graph:     ${orphanGraphNodes.length}`);
    
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
