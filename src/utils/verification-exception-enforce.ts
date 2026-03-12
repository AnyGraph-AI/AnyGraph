import { runExceptionEnforcement } from '../core/verification/index.js';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node --loader ts-node/esm src/utils/verification-exception-enforce.ts <projectId>');
    process.exit(1);
  }

  const result = await runExceptionEnforcement(projectId);
  console.log(JSON.stringify({ ok: true, projectId, result }));
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
