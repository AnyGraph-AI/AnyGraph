import { readFileSync } from 'fs';
import { join } from 'path';

interface CheckResult {
  file: string;
  ok: boolean;
  reasons: string[];
}

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

function extractQueryBlock(fileContent: string, queryName: string): string | null {
  const re = new RegExp(`${queryName}:\\s*` + '`' + `([\\s\\S]*?)` + '`' + `,?`, 'm');
  const match = fileContent.match(re);
  return match?.[1] ?? null;
}

function main(): void {
  const results: CheckResult[] = [];

  for (const relPath of TARGET_FILES) {
    const fullPath = join(process.cwd(), relPath);
    const content = readFileSync(fullPath, 'utf8');
    const reasons: string[] = [];

    const hasInlineMetricPattern = FORBIDDEN_PATTERNS.some((pattern) => pattern.test(content));
    const hasContractImport = content.includes(REQUIRED_IMPORT);

    if (hasInlineMetricPattern && !hasContractImport) {
      reasons.push('missing query-contract import for metric query usage');
    }

    results.push({
      file: relPath,
      ok: reasons.length === 0,
      reasons,
    });
  }

  // GC-11 contract gate: file-level dashboard queries must expose canonical file tier fields.
  const queryReasons: string[] = [];
  const queryFilePath = join(process.cwd(), QUERY_FILE);
  const queryContent = readFileSync(queryFilePath, 'utf8');

  for (const queryName of ['godFiles', 'fragilityIndex']) {
    const block = extractQueryBlock(queryContent, queryName);
    if (!block) {
      queryReasons.push(`${queryName} query block missing`);
      continue;
    }

    if (!/AS\s+riskTier\b/i.test(block)) {
      queryReasons.push(`${queryName} missing canonical riskTier field`);
    }
    if (!/AS\s+riskTierNum\b/i.test(block)) {
      queryReasons.push(`${queryName} missing canonical riskTierNum field`);
    }
  }

  results.push({
    file: QUERY_FILE,
    ok: queryReasons.length === 0,
    reasons: queryReasons,
  });

  const failing = results.filter((r) => !r.ok);
  if (failing.length > 0) {
    console.error(
      JSON.stringify({
        ok: false,
        failing,
      }, null, 2),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      checked: results.length,
      files: results.map((r) => r.file),
    }),
  );
}

main();
