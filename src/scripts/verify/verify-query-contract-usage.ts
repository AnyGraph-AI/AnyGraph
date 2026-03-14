import { readFileSync } from 'fs';
import { join } from 'path';

interface CheckResult {
  file: string;
  ok: boolean;
  reasons: string[];
}

const TARGET_FILES = [
  'src/utils/verification-status-dashboard.ts',
  'verify-project-registry.ts',
  'reconcile-project-registry.ts',
];

const REQUIRED_IMPORT = 'query-contract.js';

const FORBIDDEN_PATTERNS: RegExp[] = [
  /MATCH \(n\)\s*\n\s*WHERE n\.projectId IS NOT NULL/i,
  /MATCH \(p:Project\)/i,
  /MATCH \(s:IntegritySnapshot\)/i,
  /MATCH \(c:Claim\)/i,
];

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
