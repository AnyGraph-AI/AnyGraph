import { resolve } from 'node:path';

import { importSarifToVerificationBundle } from '../core/verification/sarif-importer.js';
import { ingestVerificationFoundation } from '../core/verification/verification-ingest.js';

async function main(): Promise<void> {
  const sarifPathArg = process.argv[2];
  const projectId = process.argv[3];
  const toolFilterArg = process.argv[4] as 'codeql' | 'semgrep' | 'any' | undefined;

  if (!sarifPathArg || !projectId) {
    console.error('Usage: node --loader ts-node/esm src/utils/verification-sarif-import.ts <sarifPath> <projectId> [codeql|semgrep|any]');
    process.exit(1);
  }

  const sarifPath = resolve(sarifPathArg);
  const toolFilter = toolFilterArg ?? 'codeql';

  const bundle = await importSarifToVerificationBundle({
    sarifPath,
    projectId,
    toolFilter,
  });

  const result = await ingestVerificationFoundation(bundle);

  console.log(
    JSON.stringify({
      ok: true,
      sarifPath,
      projectId,
      toolFilter,
      imported: {
        runs: bundle.verificationRuns.length,
        scopes: bundle.analysisScopes.length,
        adjudications: bundle.adjudications.length,
        pathWitnesses: bundle.pathWitnesses?.length ?? 0,
      },
      ingested: result,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
