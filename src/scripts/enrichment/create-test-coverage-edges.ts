#!/usr/bin/env npx tsx
/**
 * RF-14 (phase 1): Test Coverage Enrichment
 *
 * 1) Identify test files by naming convention and tag `isTestFile: true`.
 * 2) Trace calls from test functions to source functions.
 *
 * Existing behavior retained:
 * - Create lightweight TestFile nodes.
 * - Create file-level TESTED_BY edges from SourceFile -> TestFile.
 */
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

dotenv.config();

export interface ImportBinding {
  imported: string;
  sourceSpec: string;
  namespace?: boolean;
  defaultImport?: boolean;
}

export interface TestCallRef {
  alias: string;
  member?: string;
}

export interface TestFunctionTrace {
  functionName: string;
  calls: TestCallRef[];
}

interface TestFileInfo {
  filePath: string;
  name: string;
  imports: string[]; // resolved absolute import targets
  testCount: number;
  describeBlocks: string[];
  traces: TestFunctionTrace[];
}

const TEST_FILE_PATTERNS = [
  'src/**/*.test.ts',
  'src/**/*.audit.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.spec-test.ts', // compatibility with existing suite
  'ui/src/**/*.test.ts',   // UI dashboard tests
  'ui/src/**/*.spec.ts',
];

export function isTestFileByConvention(filePath: string): boolean {
  return /(\.test|\.spec|\.spec-test)\.ts$/i.test(filePath);
}

export function extractImportBindings(content: string): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  // import { a, b as c } from './x'
  const namedRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(namedRegex)) {
    const namedBlock = match[1] ?? '';
    const sourceSpec = match[2] ?? '';
    const parts = namedBlock
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    for (const p of parts) {
      const aliasSplit = p.split(/\s+as\s+/i).map((x) => x.trim());
      const imported = aliasSplit[0];
      const alias = aliasSplit[1] ?? imported;
      if (!alias || !imported) continue;
      bindings.set(alias, { imported, sourceSpec });
    }
  }

  // import * as ns from './x'
  const namespaceRegex = /import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(namespaceRegex)) {
    const alias = match[1];
    const sourceSpec = match[2] ?? '';
    if (!alias) continue;
    bindings.set(alias, { imported: '*', sourceSpec, namespace: true });
  }

  // import defaultName from './x'
  const defaultRegex = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/g;
  for (const match of content.matchAll(defaultRegex)) {
    const alias = match[1];
    const sourceSpec = match[2] ?? '';
    if (!alias) continue;
    if (!bindings.has(alias)) {
      bindings.set(alias, { imported: 'default', sourceSpec, defaultImport: true });
    }
  }

  // Dynamic imports: await import('@/lib/queries'), import('./foo')
  const dynamicRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of content.matchAll(dynamicRegex)) {
    const sourceSpec = match[1] ?? '';
    if (!sourceSpec) continue;
    // Use the module path as both alias and source — we just need the sourceSpec for resolution
    const alias = `__dynamic_${sourceSpec.replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (!bindings.has(alias)) {
      bindings.set(alias, { imported: '*', sourceSpec, namespace: true });
    }
  }

  return bindings;
}

/**
 * Resolve an import specifier to an absolute file path.
 * Supports:
 * - Relative imports: './foo', '../bar'
 * - tsconfig path aliases: '@/lib/queries' → '<projectRoot>/src/lib/queries.ts'
 *
 * @param spec - the import specifier string
 * @param dir - directory of the importing file
 * @param projectRoot - optional project root for alias resolution
 */
function resolveRelativeImport(spec: string, dir: string, projectRoot?: string): string | null {
  let normalized = spec;

  // Handle tsconfig path aliases: @/ → <projectRoot>/src/
  // Walk up from dir to find the nearest tsconfig.json with paths
  if (normalized.startsWith('@/') && !normalized.startsWith('@/..')) {
    const root = projectRoot ?? findProjectRoot(dir);
    if (root) {
      const aliasResolved = path.join(root, 'src', normalized.slice(2));
      normalized = path.relative(dir, aliasResolved);
      if (!normalized.startsWith('.')) normalized = './' + normalized;
    } else {
      return null;
    }
  }

  if (!normalized.startsWith('.')) return null;

  if (normalized.endsWith('.js')) normalized = normalized.replace(/\.js$/, '');
  if (normalized.endsWith('.ts')) normalized = normalized.replace(/\.ts$/, '');

  const base = path.resolve(dir, normalized);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Walk up from dir to find nearest tsconfig.json with paths.@/ alias */
function findProjectRoot(dir: string): string | null {
  let current = dir;
  for (let i = 0; i < 10; i++) {
    const tsconfig = path.join(current, 'tsconfig.json');
    if (fs.existsSync(tsconfig)) {
      try {
        const content = fs.readFileSync(tsconfig, 'utf-8');
        if (content.includes('"@/*"')) {
          return current;
        }
      } catch { /* skip */ }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function resolveImportMap(bindings: Map<string, ImportBinding>, dir: string): Map<string, { targetPath: string; imported: string; namespace?: boolean; defaultImport?: boolean }> {
  const resolved = new Map<string, { targetPath: string; imported: string; namespace?: boolean; defaultImport?: boolean }>();

  for (const [alias, binding] of bindings.entries()) {
    const targetPath = resolveRelativeImport(binding.sourceSpec, dir);
    if (!targetPath) continue;
    resolved.set(alias, {
      targetPath,
      imported: binding.imported,
      namespace: binding.namespace,
      defaultImport: binding.defaultImport,
    });
  }

  return resolved;
}

function extractDescribeBlocks(content: string): string[] {
  const describeRegex = /describe\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const blocks: string[] = [];
  for (const match of content.matchAll(describeRegex)) {
    if (match[1]) blocks.push(match[1]);
  }
  return blocks;
}

function extractTestCount(content: string): number {
  return content.match(/\b(?:it|test)\s*\(/g)?.length ?? 0;
}

export function traceTestFunctionCalls(content: string): TestFunctionTrace[] {
  const traces: TestFunctionTrace[] = [];

  const callbackRegex = /\b(it|test)\s*\(\s*(["'`])([^"'`]+)\2\s*,\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*?)\}\s*\)/g;

  for (const match of content.matchAll(callbackRegex)) {
    const functionName = match[3] ?? 'unnamed-test';
    const body = match[4] ?? '';
    const calls: TestCallRef[] = [];

    // foo(...)
    const directCallRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    for (const callMatch of body.matchAll(directCallRegex)) {
      const alias = callMatch[1];
      if (!alias) continue;
      if (['if', 'for', 'while', 'switch', 'catch', 'it', 'test', 'expect', 'describe'].includes(alias)) continue;
      calls.push({ alias });
    }

    // ns.member(...)
    const memberCallRegex = /\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
    for (const callMatch of body.matchAll(memberCallRegex)) {
      const alias = callMatch[1];
      const member = callMatch[2];
      if (!alias || !member) continue;
      calls.push({ alias, member });
    }

    traces.push({ functionName, calls });
  }

  return traces;
}

function stableTestNodeId(prefix: 'testfile' | 'testfn', value: string): string {
  const digest = crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
  return `${prefix}_${digest}`;
}

export function analyzeTestFile(filePath: string): TestFileInfo {
  const content = fs.readFileSync(filePath, 'utf-8');
  const name = path.basename(filePath);
  const dir = path.dirname(filePath);

  const bindings = extractImportBindings(content);
  const resolvedBindings = resolveImportMap(bindings, dir);
  const imports = Array.from(new Set(Array.from(resolvedBindings.values()).map((v) => v.targetPath)));

  return {
    filePath,
    name,
    imports,
    testCount: extractTestCount(content),
    describeBlocks: extractDescribeBlocks(content),
    traces: traceTestFunctionCalls(content),
  };
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
    return (value as any).toNumber();
  }
  return Number(value ?? 0);
}

export async function enrichTestCoverage(projectRoot = process.cwd()): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
      process.env.NEO4J_USER || 'neo4j',
      process.env.NEO4J_PASSWORD || 'codegraph',
    ),
  );

  const session = driver.session();

  try {
    console.log('[test-coverage] Scanning for test files...\n');

    const testFiles = globSync(TEST_FILE_PATTERNS, {
      cwd: projectRoot,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });

    const conventionTestFiles = testFiles.filter(isTestFileByConvention);
    console.log(`  Found ${conventionTestFiles.length} test files on disk`);

    const analyses = conventionTestFiles.map((filePath) => analyzeTestFile(filePath));
    const totalTests = analyses.reduce((sum, info) => sum + info.testCount, 0);
    const totalImports = analyses.reduce((sum, info) => sum + info.imports.length, 0);
    console.log(`  Total test cases: ${totalTests}`);
    console.log(`  Total source imports from tests: ${totalImports}`);

    const pidResult = await session.run(
      `MATCH (p:Project) WHERE p.path = $path RETURN p.projectId AS pid`,
      { path: projectRoot },
    );
    const projectId = pidResult.records[0]?.get('pid') || 'proj_c0d3e9a1f200';
    console.log(`  Project: ${projectId}\n`);

    // === TRANSACTION BOUNDARY: DELETE + RECREATE must be atomic (TODO-7-6 / SCAR-012 pattern) ===
    // If anything throws between delete and recreate, Neo4j rolls back both.
    // This prevents partial state from OOM kills mid-operation.
    const tx = session.beginTransaction();

    let testFileNodes = 0;
    let testedByEdges = 0;
    let tracedCalls = 0;
    let testedByFunctionEdges = 0;
    let hasTestCallerCount = 0;
    const sourceFilesCovered = new Set<string>();

    try {
      // Reset previous test artifacts for this project
      await tx.run(
        `MATCH (tf:TestFile {projectId: $pid}) DETACH DELETE tf`,
        { pid: projectId },
      );
      await tx.run(
        `MATCH (tf:TestFunction {projectId: $pid}) DETACH DELETE tf`,
        { pid: projectId },
      );
      await tx.run(
        `MATCH ()-[r:TESTED_BY]->() DELETE r`,
      );

      // Clear stale SourceFile test tag (for files that may be in graph)
      await tx.run(
        `MATCH (sf:SourceFile {projectId: $pid})
         WHERE sf.isTestFile = true
         SET sf.isTestFile = false`,
        { pid: projectId },
      );

      for (const analysis of analyses) {
        const testFileNodeId = stableTestNodeId('testfile', analysis.filePath);

        // Create TestFile node tagged with isTestFile
        await tx.run(
          `CREATE (tf:TestFile:CodeNode {
            filePath: $filePath,
            name: $name,
            projectId: $pid,
            testCount: $testCount,
            describeBlocks: $describeBlocks,
            isTestFile: true,
            namingConvention: true,
            nodeId: $nodeId
          })`,
          {
            filePath: analysis.filePath,
            name: analysis.name,
            pid: projectId,
            testCount: analysis.testCount,
            describeBlocks: analysis.describeBlocks,
            nodeId: testFileNodeId,
          },
        );
        testFileNodes++;

        // If parser includes this file as SourceFile, tag it too
        await tx.run(
          `MATCH (sf:SourceFile {projectId: $pid, filePath: $filePath})
           SET sf.isTestFile = true`,
          { pid: projectId, filePath: analysis.filePath },
        );

        // File-level TESTED_BY edges
        for (const importPath of analysis.imports) {
          const result = await tx.run(
            `MATCH (sf:SourceFile {projectId: $pid})
             WHERE sf.filePath = $importPath
             MATCH (tf:TestFile {projectId: $pid, filePath: $testPath})
             MERGE (sf)-[r:TESTED_BY]->(tf)
             SET r.derived = true,
                 r.projectId = $pid
             RETURN sf.filePath AS matched`,
            {
              pid: projectId,
              importPath,
              testPath: analysis.filePath,
            },
          );

          if (result.records.length > 0) {
            testedByEdges++;
            sourceFilesCovered.add(importPath);
          }
        }

        // RF-14 phase 1: trace CALLS from test functions to source functions
        const content = fs.readFileSync(analysis.filePath, 'utf-8');
        const resolvedBindings = resolveImportMap(extractImportBindings(content), path.dirname(analysis.filePath));

        for (let idx = 0; idx < analysis.traces.length; idx++) {
          const trace = analysis.traces[idx];
          const testFnNodeId = stableTestNodeId('testfn', `${analysis.filePath}#${idx}#${trace.functionName}`);

          await tx.run(
            `MERGE (tf:TestFunction:CodeNode {projectId: $pid, nodeId: $nodeId})
             ON CREATE SET
              tf.name = $name,
              tf.filePath = $filePath,
              tf.isTestFunction = true,
              tf.isTestFile = true,
              tf.testFilePath = $filePath,
              tf.source = 'rf14-trace'
             ON MATCH SET
              tf.name = $name,
              tf.filePath = $filePath,
              tf.source = 'rf14-trace'`,
            {
              pid: projectId,
              nodeId: testFnNodeId,
              name: trace.functionName,
              filePath: analysis.filePath,
            },
          );

          // Link TestFile -> TestFunction for traceability
          await tx.run(
            `MATCH (testFile:TestFile {projectId: $pid, filePath: $filePath})
             MATCH (testFn:TestFunction {projectId: $pid, nodeId: $testFnNodeId})
             MERGE (testFile)-[r:CONTAINS]->(testFn)
             SET r.derived = true,
                 r.projectId = $pid`,
            {
              pid: projectId,
              filePath: analysis.filePath,
              testFnNodeId,
            },
          );

          for (const call of trace.calls) {
            const binding = resolvedBindings.get(call.alias);
            if (!binding) continue;

            const targetName = call.member
              ? (binding.namespace ? call.member : binding.imported)
              : binding.imported;

            if (!targetName || targetName === '*' || targetName === 'default') continue;

            const callResult = await tx.run(
              `MATCH (testFn:TestFunction {projectId: $pid, nodeId: $testFnNodeId})
               MATCH (fn:Function {projectId: $pid, filePath: $targetPath, name: $targetName})
               MERGE (testFn)-[r:CALLS]->(fn)
               SET r.derived = true,
                   r.projectId = $pid,
                   r.fromTestTrace = true,
                   r.traceVersion = 'rf14-v1'
               RETURN count(fn) AS matched`,
              {
                pid: projectId,
                testFnNodeId,
                targetPath: binding.targetPath,
                targetName,
              },
            );

            tracedCalls += toNumber(callResult.records[0]?.get('matched'));
          }
        }
      }

      // RF-14 phase 2: materialize TESTED_BY_FUNCTION edges from traced CALLS
      const testedByFunctionResult = await tx.run(
        `MATCH (tf:TestFunction {projectId: $pid})-[:CALLS]->(f:Function {projectId: $pid})
         MERGE (tf)-[r:TESTED_BY_FUNCTION]->(f)
         SET r.derived = true,
             r.projectId = $pid,
             r.fromTestTrace = true,
             r.traceVersion = 'rf14-v1'
         RETURN count(r) AS cnt`,
        { pid: projectId },
      );
      testedByFunctionEdges = toNumber(testedByFunctionResult.records[0]?.get('cnt'));

      // RF-14 phase 2: set hasTestCaller on Function nodes
      await tx.run(
        `MATCH (f:Function {projectId: $pid})
         SET f.hasTestCaller = false`,
        { pid: projectId },
      );
      const hasCallerResult = await tx.run(
        `MATCH (f:Function {projectId: $pid})<-[:TESTED_BY_FUNCTION]-(:TestFunction {projectId: $pid})
         SET f.hasTestCaller = true
         RETURN count(DISTINCT f) AS cnt`,
        { pid: projectId },
      );
      hasTestCallerCount = toNumber(hasCallerResult.records[0]?.get('cnt'));

      await tx.commit();
    } catch (err) {
      console.error('[test-coverage] Transaction failed, rolling back:', err);
      await tx.rollback();
      throw err;
    }

    console.log(`  Created ${testFileNodes} TestFile nodes`);
    console.log(`  Created ${testedByEdges} TESTED_BY edges`);
    console.log(`  Traced ${tracedCalls} CALLS edges from test functions`);
    console.log(`  Created ${testedByFunctionEdges} TESTED_BY_FUNCTION edges`);
    console.log(`  Marked ${hasTestCallerCount} functions with hasTestCaller=true`);
    console.log(`  Source files with test coverage: ${sourceFilesCovered.size}`);

    console.log('\n═══ Coverage Report ═══════════════════════════════════════\n');

    const totalResult = await session.run(
      `MATCH (sf:SourceFile {projectId: $pid})
       WHERE coalesce(sf.isTestFile, false) = false
       RETURN count(sf) AS total`,
      { pid: projectId },
    );
    const totalSourceFiles = toNumber(totalResult.records[0]?.get('total'));

    const coveredResult = await session.run(
      `MATCH (sf:SourceFile {projectId: $pid})-[:TESTED_BY]->()
       RETURN count(DISTINCT sf) AS covered`,
      { pid: projectId },
    );
    const coveredFiles = toNumber(coveredResult.records[0]?.get('covered'));

    const coveragePct = totalSourceFiles > 0 ? ((coveredFiles / totalSourceFiles) * 100).toFixed(1) : '0.0';
    console.log(`  Source files: ${totalSourceFiles}`);
    console.log(`  Tested: ${coveredFiles} (${coveragePct}%)`);
    console.log(`  Untested: ${Math.max(0, totalSourceFiles - coveredFiles)}`);

    console.log('\n  ⚠️  CRITICAL/HIGH functions in untested files:\n');
    const gapResult = await session.run(
      `MATCH (f:Function {projectId: $pid})
       WHERE f.riskTier IN ['CRITICAL', 'HIGH']
       MATCH (sf:SourceFile {projectId: $pid})-[:CONTAINS]->(f)
       WHERE NOT (sf)-[:TESTED_BY]->()
       RETURN f.name AS function, sf.name AS file, f.riskTier AS tier,
              round(f.compositeRisk * 100) / 100 AS risk
       ORDER BY f.compositeRisk DESC LIMIT 20`,
      { pid: projectId },
    );

    if (gapResult.records.length === 0) {
      console.log('  ✅ All CRITICAL/HIGH functions are in tested files!');
    } else {
      for (const row of gapResult.records) {
        const tier = String(row.get('tier'));
        const icon = tier === 'CRITICAL' ? '🔴' : '🟠';
        console.log(`  ${icon} ${tier} ${row.get('function')} (${row.get('file')}, risk=${row.get('risk')})`);
      }
      console.log(`\n  ${gapResult.records.length} high-risk functions in untested files.`);
    }

    console.log('\n✅ Test coverage enrichment complete.');
  } finally {
    await session.close();
    await driver.close();
  }
}

export async function main(): Promise<void> {
  await enrichTestCoverage();
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/create-test-coverage-edges.ts') || process.argv[1]?.endsWith('/create-test-coverage-edges.js')) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
