import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

function runJsonScript(scriptPath: string): Record<string, unknown> {
  const out = execFileSync('node', ['--loader', 'ts-node/esm', scriptPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  const line = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith('{') && l.endsWith('}'));

  if (!line) {
    throw new Error(`No JSON output found from ${scriptPath}`);
  }

  return JSON.parse(line) as Record<string, unknown>;
}

function main(): void {
  const startedAt = new Date().toISOString();

  const snapshot = runJsonScript('graph-integrity-snapshot.ts');
  const fields = runJsonScript('verify-integrity-snapshot-fields.ts');
  const verify = runJsonScript('verify-graph-integrity.ts');

  const finishedAt = new Date().toISOString();

  const report = {
    ok: true,
    startedAt,
    finishedAt,
    snapshot,
    fields,
    verify,
  };

  const outDir = join(process.cwd(), 'artifacts', 'integrity-snapshots', 'daily-job');
  mkdirSync(outDir, { recursive: true });

  const stamp = finishedAt.replace(/[:.]/g, '-');
  const outPath = join(outDir, `${stamp}.json`);
  const latestPath = join(outDir, 'latest.json');

  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(
    JSON.stringify({
      ok: true,
      startedAt,
      finishedAt,
      outPath,
      latestPath,
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}
