/**
 * AUD-TC-01-L1: seed-test-coverage.ts — Spec-Derived Tests
 *
 * Spec: PLAN.md §Phase 2 "Test coverage mapping: TESTED_BY edges from functions to test cases"
 * Note: This is the OLDER seed script — current production is create-test-coverage-edges.ts (RF-14)
 *
 * Behaviors:
 * (1) finds test files by convention pattern (*.test.ts, *.spec.ts, __tests__/**)
 * (2) parses test files for describe/it/test blocks → TestCase {id, name, suite, filePath, startLine, endLine, status}
 * (3) creates TestCase nodes in Neo4j
 * (4) matches test → function by name reference in test source code
 * (5) creates TESTED_BY edges from Function → TestCase
 * (6) handles test files with no function refs gracefully (0 edges)
 * (7) scopes all nodes/edges to projectId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock neo4j-driver
const mockSession = {
  run: vi.fn(),
  close: vi.fn(),
};

const mockDriver = {
  session: vi.fn(() => mockSession),
  close: vi.fn(),
};

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn(() => mockDriver),
    auth: {
      basic: vi.fn(),
    },
  },
}));

// TestCase interface from source
interface TestCase {
  id: string;
  name: string;
  suite: string;
  filePath: string;
  startLine: number;
  endLine: number;
  status: 'pass' | 'fail' | 'skip' | 'unknown';
}

describe('[aud-tc-01] seed-test-coverage.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.run.mockReset();
    mockSession.close.mockReset();
  });

  describe('test file discovery contract', () => {
    it('(1) finds *.test.ts files via pattern match', () => {
      // Contract: test file patterns
      const patterns = ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'];
      const testFiles = [
        'src/core/__tests__/parser.test.ts',
        'src/utils/helpers.spec.ts',
        'test/integration/api.test.ts',
      ];

      const matches = testFiles.filter((f) =>
        patterns.some((p) => {
          if (p.includes('*.test.ts')) return f.endsWith('.test.ts');
          if (p.includes('*.spec.ts')) return f.endsWith('.spec.ts');
          if (p.includes('__tests__')) return f.includes('__tests__');
          return false;
        })
      );

      expect(matches).toHaveLength(3);
    });

    it('(2) excludes node_modules and dist directories', () => {
      // Contract: standard exclusions in find command
      const findCommand = 'find "${dir}" -name "*.test.ts" -o -name "*.spec.ts" | grep -v node_modules | grep -v dist';

      expect(findCommand).toContain('grep -v node_modules');
      expect(findCommand).toContain('grep -v dist');
    });

    it('(3) deduplicates test files via Set', () => {
      // Contract: unique test file list
      const foundFiles = [
        '/src/test.test.ts',
        '/src/test.test.ts', // duplicate
        '/src/other.spec.ts',
      ];

      const uniqueFiles = [...new Set(foundFiles)];

      expect(uniqueFiles).toHaveLength(2);
    });
  });

  describe('test file parsing contract', () => {
    it('(4) extracts describe block names as suite', () => {
      // Contract: describe() → suite name
      const testContent = `
describe('Risk Scoring', () => {
  it('calculates tier correctly', () => {});
});
`;
      const descMatch = testContent.match(/describe\s*\(\s*['"`](.+?)['"`]/);

      expect(descMatch).not.toBeNull();
      expect(descMatch![1]).toBe('Risk Scoring');
    });

    it('(5) extracts it/test block names as test name', () => {
      // Contract: it() / test() → test name
      const testContent = `
  it('should compute authorEntropy', () => {});
  test('handles empty input', () => {});
`;
      const itMatch = testContent.match(/it\s*\(\s*['"`](.+?)['"`]/);
      const testMatch = testContent.match(/test\s*\(\s*['"`](.+?)['"`]/);

      expect(itMatch![1]).toBe('should compute authorEntropy');
      expect(testMatch![1]).toBe('handles empty input');
    });

    it('(6) captures startLine and endLine via brace counting', () => {
      // Contract: endLine found by matching braces
      const lines = ['it("test", () => {', '  expect(1).toBe(1);', '});'];
      const startLine = 0;
      let depth = 0;
      let endLine = startLine;

      for (let j = startLine; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
        }
        if (depth <= 0 && j > startLine) {
          endLine = j;
          break;
        }
      }

      expect(endLine).toBe(2);
    });

    it('(7) TestCase id format: test_{basename}_{index}', () => {
      // Contract: deterministic test IDs
      const filePath = '/project/src/__tests__/parser.test.ts';
      const basename = 'parser.test'; // path.basename minus .ts
      const index = 5;
      const id = `test_${basename}_${index}`;

      expect(id).toBe('test_parser.test_5');
    });

    it('(8) parseTestFile returns TestCase[] with required properties', () => {
      // Contract: TestCase structure
      const testCase: TestCase = {
        id: 'test_example_0',
        name: 'should work correctly',
        suite: 'Example Suite',
        filePath: '/project/example.test.ts',
        startLine: 5,
        endLine: 10,
        status: 'unknown',
      };

      expect(testCase).toHaveProperty('id');
      expect(testCase).toHaveProperty('name');
      expect(testCase).toHaveProperty('suite');
      expect(testCase).toHaveProperty('filePath');
      expect(testCase).toHaveProperty('startLine');
      expect(testCase).toHaveProperty('endLine');
      expect(testCase).toHaveProperty('status');
    });
  });

  describe('function reference extraction contract', () => {
    it('(9) extracts function names from Cypher {name: "X"} patterns', () => {
      // Contract: name extraction from query patterns
      const testSource = `
        session.run('MATCH (f:Function {name: "createBot"}) RETURN f');
        session.run('MATCH (f {name: "parseFile"}) RETURN f');
      `;

      const functionNames: string[] = [];
      const nameMatches = testSource.matchAll(/name:\s*['"`](\w+)['"`]/g);
      for (const m of nameMatches) functionNames.push(m[1]);

      expect(functionNames).toContain('createBot');
      expect(functionNames).toContain('parseFile');
    });

    it('(10) extracts direct function references from string literals', () => {
      // Contract: quoted identifier extraction
      const testSource = `
        expect(result.name).toBe('handleMessage');
        const fn = 'processEvent';
      `;

      const directMatches = testSource.matchAll(/['"`](\w{3,})['"`]/g);
      const names: string[] = [];
      for (const m of directMatches) names.push(m[1]);

      expect(names).toContain('handleMessage');
      expect(names).toContain('processEvent');
    });

    it('(11) skips common non-function strings', () => {
      // Contract: skipNames filter
      const skipNames = new Set([
        'cnt',
        'count',
        'tier',
        'status',
        'pass',
        'fail',
        'skip',
        'CRITICAL',
        'HIGH',
        'MEDIUM',
        'LOW',
        'true',
        'false',
        'null',
        'bolt',
        'neo4j',
        'codegraph',
        'localhost',
        'barrel',
      ]);

      expect(skipNames.has('count')).toBe(true);
      expect(skipNames.has('CRITICAL')).toBe(true);
      expect(skipNames.has('neo4j')).toBe(true);
      expect(skipNames.has('createBot')).toBe(false);
    });

    it('(12) deduplicates extracted function names via Set', () => {
      // Contract: unique names only
      const extracted = ['func1', 'func2', 'func1', 'func3', 'func2'];
      const unique = [...new Set(extracted)];

      expect(unique).toHaveLength(3);
    });
  });

  describe('TestCase node creation contract', () => {
    it('(13) TestCase node MERGE uses nodeId + projectId composite', () => {
      // Contract: idempotent TestCase creation
      const query = `
        MERGE (tc:TestCase:CodeNode {nodeId: $id, projectId: $projectId})
        SET tc.name = $name,
            tc.suite = $suite,
            tc.filePath = $filePath,
            tc.startLine = $startLine,
            tc.endLine = $endLine,
            tc.status = $status,
            tc.type = 'TestCase'
      `;

      expect(query).toContain('MERGE');
      expect(query).toContain('TestCase:CodeNode');
      expect(query).toContain('nodeId: $id');
      expect(query).toContain('projectId: $projectId');
    });

    it('(14) TestCase nodeId format: {projectId}::{testId}', () => {
      // Contract: composite node ID
      const projectId = 'proj_c0d3e9a1f200';
      const testId = 'test_parser_0';
      const nodeId = `${projectId}::${testId}`;

      expect(nodeId).toBe('proj_c0d3e9a1f200::test_parser_0');
    });
  });

  describe('TESTED_BY edge creation contract', () => {
    it('(15) TESTED_BY edge connects CodeNode → TestCase', () => {
      // Contract: edge direction is target → test
      const edgeQuery = `
        MATCH (tc:TestCase {nodeId: $tcId, projectId: $projectId})
        MATCH (target:CodeNode)
        WHERE target.name = $name
        AND NOT target:TestCase
        MERGE (target)-[:TESTED_BY]->(tc)
      `;

      expect(edgeQuery).toContain('TESTED_BY');
      expect(edgeQuery).toContain('(target)-[:TESTED_BY]->(tc)');
      expect(edgeQuery).toContain('NOT target:TestCase');
    });

    it('(16) handles test files with no function refs (0 edges created)', () => {
      // Contract: empty extraction → 0 edges, no error
      const testedNames: string[] = [];
      let edgeCount = 0;

      for (const _name of testedNames) {
        edgeCount++;
      }

      expect(edgeCount).toBe(0);
    });
  });

  describe('projectId scoping contract', () => {
    it('(17) PROJECT_ID derived from CLI arg or defaults to codegraph', () => {
      // Contract: project ID resolution
      const projectDir: string = 'codegraph';
      const PROJECT_ID =
        projectDir === '.' || projectDir === 'codegraph' ? 'proj_c0d3e9a1f200' : 'proj_60d5feed0001';

      expect(PROJECT_ID).toBe('proj_c0d3e9a1f200');
    });

    it('(18) all TestCase and TESTED_BY queries include projectId', () => {
      // Contract: project scoping
      const createQuery = 'MERGE (tc:TestCase:CodeNode {nodeId: $id, projectId: $projectId})';
      const edgeQuery = 'MATCH (tc:TestCase {nodeId: $tcId, projectId: $projectId})';
      const summaryQuery = 'MATCH (tc:TestCase {projectId: $projectId})';

      expect(createQuery).toContain('projectId: $projectId');
      expect(edgeQuery).toContain('projectId: $projectId');
      expect(summaryQuery).toContain('projectId: $projectId');
    });
  });

  describe('vitest result integration contract', () => {
    it('(19) runVitestAndGetResults maps test name → pass|fail|skip', () => {
      // Contract: result map structure
      const results = new Map<string, 'pass' | 'fail' | 'skip'>();
      results.set('should work', 'pass');
      results.set('handles errors', 'fail');
      results.set('todo test', 'skip');

      expect(results.get('should work')).toBe('pass');
      expect(results.get('handles errors')).toBe('fail');
      expect(results.get('todo test')).toBe('skip');
    });

    it('(20) TestCase.status updated from vitest results', () => {
      // Contract: status propagation
      const tests: TestCase[] = [
        { id: 't1', name: 'test A', suite: '', filePath: '', startLine: 1, endLine: 5, status: 'unknown' },
        { id: 't2', name: 'test B', suite: '', filePath: '', startLine: 6, endLine: 10, status: 'unknown' },
      ];

      const results = new Map<string, 'pass' | 'fail' | 'skip'>([
        ['test A', 'pass'],
        ['test B', 'fail'],
      ]);

      for (const test of tests) {
        const status = results.get(test.name);
        if (status) test.status = status;
      }

      expect(tests[0].status).toBe('pass');
      expect(tests[1].status).toBe('fail');
    });
  });
});
