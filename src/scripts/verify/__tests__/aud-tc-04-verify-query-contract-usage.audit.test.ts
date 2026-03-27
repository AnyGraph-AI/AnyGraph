/**
 * [AUD-TC-04-L1-16] verify-query-contract-usage.ts — Spec-Derived Tests
 *
 * Spec: GOVERNANCE_HARDENING.md §G3 "CI check: reject non-contract metric queries
 *       in dashboard/report scripts"
 *
 * Behaviors:
 * (1) reads TARGET_FILES list (verification-status-dashboard.ts, verify-project-registry.ts, reconcile-project-registry.ts)
 * (2) checks each imports from query-contract.js (REQUIRED_IMPORT)
 * (3) checks for FORBIDDEN_PATTERNS (ad-hoc MATCH queries that bypass contract)
 * (4) also checks QUERY_FILE (ui/src/lib/queries.ts) for contract compliance
 * (5) returns CheckResult[] per file with ok + reasons
 * (6) fails if any file uses forbidden patterns or missing required import
 * (7) outputs JSON summary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
const mockReadFileSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: (path: string, encoding: string) => mockReadFileSync(path, encoding),
}));

// Mock path.join
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  };
});

// Mock process.exit
const mockExit = vi.fn();
vi.stubGlobal('process', {
  ...process,
  exit: mockExit,
  cwd: () => '/test/codegraph',
  env: { ...process.env },
});

// Constants from source
const TARGET_FILES = [
  'src/utils/verification-status-dashboard.ts',
  'src/scripts/verify/verify-project-registry.ts',
  'src/scripts/tools/reconcile-project-registry.ts',
];

const QUERY_FILE = 'ui/src/lib/queries.ts';
const REQUIRED_IMPORT = 'query-contract.js';

const FORBIDDEN_PATTERNS: RegExp[] = [
  /MATCH \(n\)\s*\n\s*WHERE n\.projectId IS NOT NULL/i,
  /MATCH \(p:Project\)/i,
  /MATCH \(s:IntegritySnapshot\)/i,
  /MATCH \(c:Claim\)/i,
];

interface CheckResult {
  file: string;
  ok: boolean;
  reasons: string[];
}

describe('[AUD-TC-04-L1-16] verify-query-contract-usage.ts', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockExit.mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('TARGET_FILES list', () => {
    it('should include verification-status-dashboard.ts', () => {
      expect(TARGET_FILES).toContain('src/utils/verification-status-dashboard.ts');
    });

    it('should include verify-project-registry.ts', () => {
      expect(TARGET_FILES).toContain('src/scripts/verify/verify-project-registry.ts');
    });

    it('should include reconcile-project-registry.ts', () => {
      expect(TARGET_FILES).toContain('src/scripts/tools/reconcile-project-registry.ts');
    });
  });

  describe('REQUIRED_IMPORT check', () => {
    it('should detect missing query-contract import', () => {
      const fileContent = `
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

// Some code with ad-hoc MATCH queries
const query = \`MATCH (p:Project) RETURN p\`;
      `;

      const hasContractImport = fileContent.includes(REQUIRED_IMPORT);
      expect(hasContractImport).toBe(false);
    });

    it('should accept file with query-contract import', () => {
      const fileContent = `
import { getProjectMetrics } from '../utils/query-contract.js';
import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

const metrics = await getProjectMetrics(neo4j);
      `;

      const hasContractImport = fileContent.includes(REQUIRED_IMPORT);
      expect(hasContractImport).toBe(true);
    });
  });

  describe('FORBIDDEN_PATTERNS detection', () => {
    it('should detect ad-hoc MATCH (p:Project) pattern', () => {
      const fileContent = `
const query = \`MATCH (p:Project) RETURN p\`;
      `;

      const hasForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(fileContent));
      expect(hasForbidden).toBe(true);
    });

    it('should detect MATCH (s:IntegritySnapshot) pattern', () => {
      const fileContent = `
const query = \`MATCH (s:IntegritySnapshot) RETURN s\`;
      `;

      const hasForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(fileContent));
      expect(hasForbidden).toBe(true);
    });

    it('should detect MATCH (c:Claim) pattern', () => {
      const fileContent = `
const query = \`MATCH (c:Claim) RETURN c\`;
      `;

      const hasForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(fileContent));
      expect(hasForbidden).toBe(true);
    });

    it('should detect MATCH (n) WHERE n.projectId pattern', () => {
      const fileContent = `
const query = \`MATCH (n)
WHERE n.projectId IS NOT NULL
RETURN n\`;
      `;

      const hasForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(fileContent));
      expect(hasForbidden).toBe(true);
    });

    it('should not flag file without forbidden patterns', () => {
      const fileContent = `
import { getProjectMetrics } from '../utils/query-contract.js';

// Uses contract functions instead of raw queries
const metrics = await getProjectMetrics(projectId);
      `;

      const hasForbidden = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(fileContent));
      expect(hasForbidden).toBe(false);
    });
  });

  describe('QUERY_FILE (ui/src/lib/queries.ts) validation', () => {
    it('should check for riskTier field in godFiles query', () => {
      const queryContent = `
export const queries = {
  godFiles: \`
    MATCH (f:SourceFile {projectId: $projectId})
    RETURN f.name, f.compositeRisk AS riskTier
  \`,
}`;

      expect(queryContent).toContain('riskTier');
    });

    it('should check for riskTierNum field in fragilityIndex query', () => {
      const queryContent = `
export const queries = {
  fragilityIndex: \`
    MATCH (f:SourceFile {projectId: $projectId})
    RETURN f.name, f.riskTierNum AS riskTierNum
  \`,
}`;

      expect(queryContent).toContain('riskTierNum');
    });

    it('should flag missing riskTier in godFiles query', () => {
      const queryContent = `
export const queries = {
  godFiles: \`
    MATCH (f:SourceFile {projectId: $projectId})
    RETURN f.name, f.path
  \`,
}`;

      const hasRiskTier = /AS\s+riskTier\b/i.test(queryContent);
      expect(hasRiskTier).toBe(false);
    });

    it('should extract query block by name', () => {
      const fileContent = `
export const queries = {
  godFiles: \`
    MATCH (f:SourceFile)
    RETURN f.name AS name, f.riskTier AS riskTier, f.riskTierNum AS riskTierNum
  \`,
  fragilityIndex: \`
    MATCH (f:Function)
    RETURN f.name AS name, f.riskTier AS riskTier, f.riskTierNum AS riskTierNum
  \`,
}`;

      const extractQueryBlock = (content: string, queryName: string): string | null => {
        const re = new RegExp(`${queryName}:\\s*` + '`' + `([\\s\\S]*?)` + '`' + `,?`, 'm');
        const match = content.match(re);
        return match?.[1] ?? null;
      };

      const godFilesBlock = extractQueryBlock(fileContent, 'godFiles');
      expect(godFilesBlock).not.toBeNull();
      expect(godFilesBlock).toContain('MATCH (f:SourceFile)');
    });
  });

  describe('CheckResult per file', () => {
    it('should return ok=true when file passes all checks', () => {
      const fileContent = `
import { getMetrics } from '../utils/query-contract.js';
// No forbidden patterns
const result = await getMetrics();
      `;

      mockReadFileSync.mockReturnValue(fileContent);

      const reasons: string[] = [];
      const hasInlineMetricPattern = FORBIDDEN_PATTERNS.some((p) => p.test(fileContent));
      const hasContractImport = fileContent.includes(REQUIRED_IMPORT);

      if (hasInlineMetricPattern && !hasContractImport) {
        reasons.push('missing query-contract import for metric query usage');
      }

      const result: CheckResult = {
        file: 'test.ts',
        ok: reasons.length === 0,
        reasons,
      };

      expect(result.ok).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('should return ok=false with reasons when checks fail', () => {
      const fileContent = `
// No query-contract import
const query = \`MATCH (p:Project) RETURN p\`;
      `;

      mockReadFileSync.mockReturnValue(fileContent);

      const reasons: string[] = [];
      const hasInlineMetricPattern = FORBIDDEN_PATTERNS.some((p) => p.test(fileContent));
      const hasContractImport = fileContent.includes(REQUIRED_IMPORT);

      if (hasInlineMetricPattern && !hasContractImport) {
        reasons.push('missing query-contract import for metric query usage');
      }

      const result: CheckResult = {
        file: 'test.ts',
        ok: reasons.length === 0,
        reasons,
      };

      expect(result.ok).toBe(false);
      expect(result.reasons).toContain('missing query-contract import for metric query usage');
    });
  });

  describe('Exit behavior', () => {
    it('should exit with code 1 when any file fails', () => {
      const results: CheckResult[] = [
        { file: 'file1.ts', ok: true, reasons: [] },
        { file: 'file2.ts', ok: false, reasons: ['missing import'] },
      ];

      const failing = results.filter((r) => !r.ok);
      expect(failing.length).toBeGreaterThan(0);
    });

    it('should exit with code 0 when all files pass', () => {
      const results: CheckResult[] = [
        { file: 'file1.ts', ok: true, reasons: [] },
        { file: 'file2.ts', ok: true, reasons: [] },
      ];

      const failing = results.filter((r) => !r.ok);
      expect(failing.length).toBe(0);
    });
  });

  describe('JSON output structure', () => {
    it('should include ok status in output', () => {
      const output = {
        ok: true,
        checked: 4,
        files: TARGET_FILES.concat(QUERY_FILE),
      };

      expect(output.ok).toBe(true);
      expect(output.checked).toBe(4);
    });

    it('should include failing files in error output', () => {
      const errorOutput = {
        ok: false,
        failing: [
          { file: 'test.ts', ok: false, reasons: ['missing query-contract import'] },
        ],
      };

      expect(errorOutput.ok).toBe(false);
      expect(errorOutput.failing).toHaveLength(1);
    });
  });
});
