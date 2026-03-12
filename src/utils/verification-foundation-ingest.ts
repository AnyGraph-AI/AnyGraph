import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  VerificationFoundationBundleSchema,
  ingestVerificationFoundation,
} from '../core/verification/index.js';

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node --loader ts-node/esm src/utils/verification-foundation-ingest.ts <bundle.json>');
    process.exit(1);
  }

  const abs = resolve(inputPath);
  const raw = await readFile(abs, 'utf8');
  const json = JSON.parse(raw);
  const bundle = VerificationFoundationBundleSchema.parse(json);
  const result = await ingestVerificationFoundation(bundle);

  console.log(
    JSON.stringify({
      ok: true,
      input: abs,
      projectId: bundle.projectId,
      result,
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
