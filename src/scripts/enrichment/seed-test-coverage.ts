/**
 * Test Coverage Mapping — Create TestCase nodes + TESTED_BY edges
 * 
 * Parses vitest test files, extracts test cases, and links them to
 * the CodeGraph functions they exercise (via function name references
 * in the test source code).
 * 
 * Usage: npx tsx seed-test-coverage.ts [project-dir]
 * Default project-dir: . (CodeGraph self-graph)
 */
import * as fs from 'fs';
import * as path from 'path';
import neo4j from 'neo4j-driver';
import { execSync } from 'child_process';

const projectDir = process.argv[2] || '.';
const PROJECT_ID = projectDir === '.' || projectDir === 'codegraph' 
  ? 'proj_c0d3e9a1f200' 
  : 'proj_60d5feed0001';

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'codegraph'));

interface TestCase {
  id: string;
  name: string;
  suite: string;
  filePath: string;
  startLine: number;
  endLine: number;
  status: 'pass' | 'fail' | 'skip' | 'unknown';
}

async function findTestFiles(dir: string): Promise<string[]> {
  const testFiles: string[] = [];
  const patterns = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'];
  
  for (const pattern of patterns) {
    try {
      const result = execSync(`find "${dir}" -name "*.test.ts" -o -name "*.spec.ts" | grep -v node_modules | grep -v dist`, 
        { encoding: 'utf-8', cwd: dir }).trim();
      if (result) {
        testFiles.push(...result.split('\n').filter(Boolean));
      }
    } catch { /* no matches */ }
  }
  return [...new Set(testFiles)];
}

function parseTestFile(filePath: string): TestCase[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const tests: TestCase[] = [];
  let currentSuite = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Match describe blocks
    const descMatch = line.match(/describe\s*\(\s*['"`](.+?)['"`]/);
    if (descMatch) {
      currentSuite = descMatch[1];
    }
    
    // Match it/test blocks
    const testMatch = line.match(/(?:it|test)\s*\(\s*['"`](.+?)['"`]/);
    if (testMatch) {
      const testName = testMatch[1];
      
      // Find the end of this test block (matching closing brace)
      let depth = 0;
      let endLine = i;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
        if (depth <= 0 && j > i) {
          endLine = j;
          break;
        }
      }
      
      const id = `test_${path.basename(filePath, '.ts')}_${tests.length}`;
      tests.push({
        id,
        name: testName,
        suite: currentSuite,
        filePath,
        startLine: i + 1,
        endLine: endLine + 1,
        status: 'unknown'
      });
    }
  }
  return tests;
}

function extractTestedFunctions(testSource: string): string[] {
  const functionNames: string[] = [];
  
  // Match Cypher queries referencing specific node names: {name: 'createBot'}
  const nameMatches = testSource.matchAll(/name:\s*['"`](\w+)['"`]/g);
  for (const m of nameMatches) functionNames.push(m[1]);
  
  // Match direct function references in assertions
  const directMatches = testSource.matchAll(/['"`](\w{3,})['"`]/g);
  for (const m of directMatches) {
    const name = m[1];
    // Skip common non-function strings
    if (['cnt', 'count', 'tier', 'status', 'pass', 'fail', 'skip', 'CRITICAL', 
         'HIGH', 'MEDIUM', 'LOW', 'true', 'false', 'null', 'bolt', 'neo4j',
         'codegraph', 'localhost', 'barrel'].includes(name)) continue;
    functionNames.push(name);
  }
  
  return [...new Set(functionNames)];
}

async function runVitestAndGetResults(dir: string): Promise<Map<string, 'pass' | 'fail' | 'skip'>> {
  const results = new Map<string, 'pass' | 'fail' | 'skip'>();
  try {
    const output = execSync('npx vitest run --reporter=json 2>/dev/null', {
      encoding: 'utf-8',
      cwd: dir,
      timeout: 60000
    });
    const json = JSON.parse(output);
    for (const file of json.testResults || []) {
      for (const test of file.assertionResults || []) {
        const name = test.title || test.fullName;
        results.set(name, test.status === 'passed' ? 'pass' : test.status === 'failed' ? 'fail' : 'skip');
      }
    }
  } catch (e: any) {
    // Try to parse JSON from stderr/stdout even on failure
    try {
      const jsonStr = e.stdout || e.stderr || '';
      const jsonStart = jsonStr.indexOf('{');
      if (jsonStart >= 0) {
        const json = JSON.parse(jsonStr.slice(jsonStart));
        for (const file of json.testResults || []) {
          for (const test of file.assertionResults || []) {
            const name = test.title || test.fullName;
            results.set(name, test.status === 'passed' ? 'pass' : test.status === 'failed' ? 'fail' : 'skip');
          }
        }
      }
    } catch { /* couldn't parse */ }
  }
  return results;
}

async function ingestTestCoverage(tests: TestCase[], projectId: string) {
  const session = driver.session();
  try {
    // Create TestCase nodes
    console.log(`\nCreating ${tests.length} TestCase nodes...`);
    for (const test of tests) {
      await session.run(`
        MERGE (tc:TestCase:CodeNode {nodeId: $id, projectId: $projectId})
        SET tc.name = $name,
            tc.suite = $suite,
            tc.filePath = $filePath,
            tc.startLine = $startLine,
            tc.endLine = $endLine,
            tc.status = $status,
            tc.type = 'TestCase'
      `, {
        id: `${projectId}::${test.id}`,
        projectId,
        name: test.name,
        suite: test.suite,
        filePath: test.filePath,
        startLine: test.startLine,
        endLine: test.endLine,
        status: test.status
      });
    }
    
    // Create TESTED_BY edges based on what each test verifies
    console.log('Creating TESTED_BY edges...');
    let edgeCount = 0;
    
    for (const test of tests) {
      const testContent = fs.readFileSync(test.filePath, 'utf-8');
      const testLines = testContent.split('\n').slice(test.startLine - 1, test.endLine);
      const testBlock = testLines.join('\n');
      
      const testedNames = extractTestedFunctions(testBlock);
      
      // Filter out property names and Neo4j labels - only keep actual function/class names
      const skipNames = new Set([
        'riskTier', 'riskLevel', 'fanInCount', 'fanOutCount', 'conditional', 
        'isAsync', 'crossFile', 'filePath', 'nodeId', 'dynamic', 'name',
        'Function', 'Method', 'Class', 'Variable', 'Import', 'SourceFile', 
        'Field', 'Entrypoint', 'CommandHandler', 'CallbackQueryHandler',
        'CodeNode', 'TestCase', 'cnt', 'count', 'total', 'resolved', 'pct',
        'tier', 'level', 'missing', 'empty', 'unresolved', 'duplicates'
      ]);
      
      for (const name of testedNames) {
        if (skipNames.has(name)) continue;
        
        // Link to actual function/class/method nodes by name (search ALL projects)
        const result = await session.run(`
          MATCH (tc:TestCase {nodeId: $tcId, projectId: $projectId})
          MATCH (target:CodeNode)
          WHERE target.name = $name
          AND NOT target:TestCase
          MERGE (target)-[:TESTED_BY]->(tc)
          RETURN count(*) AS cnt
        `, {
          tcId: `${projectId}::${test.id}`,
          projectId,
          name
        });
        edgeCount += result.records[0]?.get('cnt')?.toNumber?.() || 0;
      }
      
      // Also link by suite name → feature area
      // e.g., "Grammy Framework Schema" tests → Grammy-related nodes
      if (test.suite) {
        const suiteKeywords: Record<string, string[]> = {
          'Grammy Framework Schema': ['CommandHandler', 'CallbackQueryHandler', 'Entrypoint'],
          'Risk Scoring': ['riskLevel', 'riskTier', 'fanInCount', 'fanOutCount'],
          'Import Resolution': ['RESOLVES_TO', 'Import'],
          'CALLS Edge Properties': ['CALLS', 'conditional', 'isAsync'],
          'Structural Invariants': ['SourceFile', 'Function'],
        };
        
        // The suite mappings create conceptual links — mark what feature each test covers
        const keywords = suiteKeywords[test.suite] || [];
        for (const kw of keywords) {
          await session.run(`
            MATCH (tc:TestCase {nodeId: $tcId, projectId: $projectId})
            SET tc.testFeatures = coalesce(tc.testFeatures, []) + $keyword
          `, {
            tcId: `${projectId}::${test.id}`,
            projectId,
            keyword: kw
          });
        }
      }
    }
    
    console.log(`  Created ${edgeCount} TESTED_BY edges`);
    
    // Summary
    const summary = await session.run(`
      MATCH (tc:TestCase {projectId: $projectId})
      RETURN tc.status AS status, count(tc) AS cnt
      ORDER BY cnt DESC
    `, { projectId });
    
    console.log('\nTest coverage summary:');
    for (const r of summary.records) {
      console.log(`  ${r.get('status')}: ${r.get('cnt')}`);
    }
    
    const covered = await session.run(`
      MATCH (target:CodeNode {projectId: $projectId})-[:TESTED_BY]->(tc:TestCase)
      WHERE NOT target:TestCase
      RETURN count(DISTINCT target) AS covered
    `, { projectId });
    
    const total = await session.run(`
      MATCH (f:Function {projectId: $projectId})
      RETURN count(f) AS total
    `, { projectId });
    
    const coveredCount = covered.records[0]?.get('covered')?.toNumber?.() || 0;
    const totalCount = total.records[0]?.get('total')?.toNumber?.() || 0;
    const pct = totalCount > 0 ? ((coveredCount / totalCount) * 100).toFixed(1) : '0';
    console.log(`\n  Nodes with test coverage: ${coveredCount}/${totalCount} (${pct}%)`);
    
  } finally {
    await session.close();
  }
}

async function main() {
  const resolvedDir = path.resolve(projectDir === 'codegraph' ? '.' : projectDir);
  console.log(`Scanning for test files in: ${resolvedDir}`);
  
  const testFiles = await findTestFiles(resolvedDir);
  console.log(`Found ${testFiles.length} test file(s):`);
  testFiles.forEach(f => console.log(`  ${f}`));
  
  if (testFiles.length === 0) {
    console.log('No test files found. Skipping.');
    await driver.close();
    return;
  }
  
  // Parse test files
  let allTests: TestCase[] = [];
  for (const file of testFiles) {
    const absPath = path.resolve(resolvedDir, file);
    const tests = parseTestFile(absPath);
    allTests.push(...tests);
  }
  console.log(`\nParsed ${allTests.length} test cases`);
  
  // Run vitest to get pass/fail status
  console.log('Running vitest...');
  const results = await runVitestAndGetResults(resolvedDir);
  console.log(`  Got results for ${results.size} tests`);
  
  // Update test statuses
  for (const test of allTests) {
    const status = results.get(test.name);
    if (status) test.status = status;
  }
  
  // Ingest to Neo4j
  await ingestTestCoverage(allTests, PROJECT_ID);
  
  await driver.close();
  console.log('\n✅ Test coverage mapping complete!');
}

main().catch(console.error);
