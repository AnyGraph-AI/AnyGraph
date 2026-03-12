import { runScopeResolver } from '../core/verification/index.js';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node --loader ts-node/esm src/utils/verification-scope-resolve.ts <projectId>');
    process.exit(1);
  }

  const result = await runScopeResolver(projectId);
  console.log(JSON.stringify({ ok: true, projectId, result }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  process.exit(1);
});
