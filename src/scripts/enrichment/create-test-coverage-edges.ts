#!/usr/bin/env npx tsx
/**
 * Test Coverage Enrichment — Wire test files to source files they test.
 *
 * Scans disk for *.test.ts / *.spec-test.ts files, reads their imports,
 * resolves to SourceFile nodes in the graph, creates TESTED_BY edges.
 *
 * Does NOT touch the parser or modify exclude patterns.
 * Test files stay excluded from the code graph — only the edges are added.
 *
 * Edge: (SourceFile)-[:TESTED_BY {derived: true}]->(TestFile:CodeNode)
 * TestFile nodes are lightweight: just filePath, name, testFramework, testCount.
 *
 * Usage: npm run enrich:test-coverage
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';

dotenv.config();

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'codegraph',
  ),
);

interface TestFileInfo {
  filePath: string;
  name: string;
  imports: string[];       // resolved absolute paths of imported source files
  testCount: number;       // number of it()/test() calls
  describeBlocks: string[]; // describe() block names
}

function analyzeTestFile(filePath: string, projectRoot: string): TestFileInfo {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = path.basename(filePath);
  const dir = path.dirname(filePath);

  // Extract imports — both static and from/require
  const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  const rawImports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1] || match[2];
    if (spec && spec.startsWith('.')) {
      rawImports.push(spec);
    }
  }

  // Resolve imports to absolute paths, handling .js → .ts
  const resolvedImports: string[] = [];
  for (const spec of rawImports) {
    let resolved = spec;
    // Strip .js extension for ESM
    if (resolved.endsWith('.js')) {
      resolved = resolved.replace(/\.js$/, '');
    }
    // Strip .ts extension if present
    if (resolved.endsWith('.ts')) {
      resolved = resolved.replace(/\.ts$/, '');
    }

    const base = path.resolve(dir, resolved);

    // Try .ts first, then /index.ts
    const candidates = [
      base + '.ts',
      base + '/index.ts',
      base,  // exact match (e.g. already has extension)
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        resolvedImports.push(candidate);
        break;
      }
    }
  }

  // Count test cases
  const testMatches = content.match(/\b(?:it|test)\s*\(/g);
  const testCount = testMatches?.length || 0;

  // Extract describe block names
  const describeRegex = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const describeBlocks: string[] = [];
  while ((match = describeRegex.exec(content)) !== null) {
    describeBlocks.push(match[1]);
  }

  return {
    filePath,
    name,
    imports: resolvedImports,
    testCount,
    describeBlocks,
  };
}

async function main() {
  const projectRoot = process.cwd();
  console.log('[test-coverage] Scanning for test files...\n');

  // Find all test files
  const testFiles = globSync('src/**/*.{test,spec-test}.ts', {
    cwd: projectRoot,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  console.log(`  Found ${testFiles.length} test files on disk`);

  // Analyze each test file
  const analyses: TestFileInfo[] = [];
  for (const tf of testFiles) {
    const info = analyzeTestFile(tf, projectRoot);
    analyses.push(info);
  }

  const totalTests = analyses.reduce((s, a) => s + a.testCount, 0);
  const totalImports = analyses.reduce((s, a) => s + a.imports.length, 0);
  console.log(`  Total test cases: ${totalTests}`);
  console.log(`  Total source imports from tests: ${totalImports}`);

  // Get projectId
  const session = driver.session();
  try {
    const pidResult = await session.run(
      `MATCH (p:Project) WHERE p.path = $path RETURN p.projectId AS pid`,
      { path: projectRoot },
    );
    const projectId = pidResult.records[0]?.get('pid') || 'proj_c0d3e9a1f200';
    console.log(`  Project: ${projectId}\n`);

    // Clear existing test coverage data
    const clearResult = await session.run(`
      MATCH (tf:TestFile {projectId: $pid}) DETACH DELETE tf
      RETURN count(tf) AS cleared
    `, { pid: projectId });
    const cleared = clearResult.records[0]?.get('cleared');
    if (cleared && (typeof cleared === 'number' ? cleared : cleared.toNumber()) > 0) {
      console.log(`  Cleared ${typeof cleared === 'number' ? cleared : cleared.toNumber()} old TestFile nodes`);
    }

    // Also clear old TESTED_BY edges (in case TestFile nodes were already deleted)
    await session.run(`
      MATCH ()-[r:TESTED_BY]->() DELETE r
    `);

    // Create TestFile nodes and TESTED_BY edges
    let testFileNodes = 0;
    let testedByEdges = 0;
    let sourceFilesCovered = new Set<string>();

    for (const analysis of analyses) {
      // Create TestFile node
      await session.run(`
        CREATE (tf:TestFile:CodeNode {
          filePath: $filePath,
          name: $name,
          projectId: $pid,
          testCount: $testCount,
          describeBlocks: $describeBlocks,
          nodeId: 'testfile_' + $name
        })
      `, {
        filePath: analysis.filePath,
        name: analysis.name,
        pid: projectId,
        testCount: analysis.testCount,
        describeBlocks: analysis.describeBlocks,
      });
      testFileNodes++;

      // Create TESTED_BY edges from source files to this test file
      for (const importPath of analysis.imports) {
        const result = await session.run(`
          MATCH (sf:SourceFile {projectId: $pid})
          WHERE sf.filePath = $importPath
          MATCH (tf:TestFile {filePath: $testPath, projectId: $pid})
          MERGE (sf)-[r:TESTED_BY]->(tf)
          SET r.derived = true
          RETURN sf.filePath AS matched
        `, {
          pid: projectId,
          importPath,
          testPath: analysis.filePath,
        });

        if (result.records.length > 0) {
          testedByEdges++;
          sourceFilesCovered.add(importPath);
        }
      }
    }

    console.log(`  Created ${testFileNodes} TestFile nodes`);
    console.log(`  Created ${testedByEdges} TESTED_BY edges`);
    console.log(`  Source files with test coverage: ${sourceFilesCovered.size}`);

    // Query coverage gaps
    console.log('\n═══ Coverage Report ═══════════════════════════════════════\n');

    // Total source files
    const totalResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $pid})
      WHERE NOT sf.filePath CONTAINS '.test.' AND NOT sf.filePath CONTAINS '.spec-test.'
      RETURN count(sf) AS total
    `, { pid: projectId });
    const totalSourceFiles = (totalResult.records[0]?.get('total') as any)?.toNumber?.() ?? totalResult.records[0]?.get('total') ?? 0;

    // Covered source files
    const coveredResult = await session.run(`
      MATCH (sf:SourceFile {projectId: $pid})-[:TESTED_BY]->()
      RETURN count(DISTINCT sf) AS covered
    `, { pid: projectId });
    const coveredFiles = (coveredResult.records[0]?.get('covered') as any)?.toNumber?.() ?? coveredResult.records[0]?.get('covered') ?? 0;

    const coveragePct = totalSourceFiles > 0 ? ((coveredFiles / totalSourceFiles) * 100).toFixed(1) : '0';
    console.log(`  Source files: ${totalSourceFiles}`);
    console.log(`  Tested: ${coveredFiles} (${coveragePct}%)`);
    console.log(`  Untested: ${totalSourceFiles - coveredFiles}`);

    // CRITICAL/HIGH risk functions without test coverage
    console.log('\n  ⚠️  CRITICAL/HIGH functions in untested files:\n');
    const gapResult = await session.run(`
      MATCH (f:Function {projectId: $pid})
      WHERE f.riskTier IN ['CRITICAL', 'HIGH']
      MATCH (sf:SourceFile)-[:CONTAINS]->(f)
      WHERE NOT (sf)-[:TESTED_BY]->()
      RETURN f.name AS function, sf.name AS file, f.riskTier AS tier,
             round(f.riskLevel * 100) / 100 AS risk
      ORDER BY f.riskLevel DESC LIMIT 20
    `, { pid: projectId });

    if (gapResult.records.length === 0) {
      console.log('  ✅ All CRITICAL/HIGH functions are in tested files!');
    } else {
      for (const r of gapResult.records) {
        const tier = r.get('tier');
        const icon = tier === 'CRITICAL' ? '🔴' : '🟠';
        console.log(`  ${icon} ${tier} ${r.get('function')} (${r.get('file')}, risk=${r.get('risk')})`);
      }
      console.log(`\n  ${gapResult.records.length} high-risk functions in untested files.`);
    }

  } finally {
    await session.close();
    await driver.close();
  }

  console.log('\n✅ Test coverage enrichment complete.');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
