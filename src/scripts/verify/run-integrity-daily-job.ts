import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

/** Error thrown when a sub-script exits with non-zero code */
class SubScriptExitError extends Error {
  exitCode: number;
  constructor(scriptPath: string, exitCode: number, stderr?: string) {
    const msg = stderr
      ? `Sub-script ${scriptPath} exited with code ${exitCode}: ${stderr}`
      : `Sub-script ${scriptPath} exited with code ${exitCode}`;
    super(msg);
    this.name = 'SubScriptExitError';
    this.exitCode = exitCode;
  }
}

/** Error thrown when sub-script output cannot be parsed as JSON */
class ParseError extends Error {
  constructor(scriptPath: string) {
    super(`No JSON output found from ${scriptPath}`);
    this.name = 'ParseError';
  }
}

function runJsonScript(scriptPath: string): Record<string, unknown> {
  let out: string;
  try {
    out = execFileSync('node', ['--loader', 'ts-node/esm', scriptPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
  } catch (err: unknown) {
    // execFileSync throws on non-zero exit — extract and propagate exit code
    const e = err as { status?: number; stderr?: string | Buffer };
    const exitCode = e.status ?? 1;
    const stderr = e.stderr ? String(e.stderr).trim() : undefined;
    throw new SubScriptExitError(scriptPath, exitCode, stderr);
  }

  const line = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => l.startsWith('{') && l.endsWith('}'));

  if (!line) {
    throw new ParseError(scriptPath);
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
  if (error instanceof SubScriptExitError) {
    // Sub-script exited non-zero — propagate its exit code
    console.error(
      JSON.stringify({
        ok: false,
        errorType: 'exitCode',
        exitCode: error.exitCode,
        error: error.message,
      }),
    );
    process.exit(error.exitCode);
  } else if (error instanceof ParseError) {
    // Sub-script exited 0 but produced no JSON
    console.error(
      JSON.stringify({
        ok: false,
        errorType: 'parseError',
        error: error.message,
      }),
    );
    process.exit(1);
  } else {
    // Unknown error
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  }
}
