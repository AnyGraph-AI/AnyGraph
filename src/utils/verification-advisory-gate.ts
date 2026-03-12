import { runAdvisoryGate } from '../core/verification/index.js';

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: node --loader ts-node/esm src/utils/verification-advisory-gate.ts <projectId> [policyBundleId]');
    process.exit(1);
  }

  const policyBundleId = process.argv[3];

  const result = await runAdvisoryGate(projectId, {
    policyBundleId,
    runExceptionPolicyFirst: true,
  });

  console.log(
    JSON.stringify({
      ok: true,
      projectId,
      policyBundleId: policyBundleId ?? 'verification-gate-policy-v1',
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
