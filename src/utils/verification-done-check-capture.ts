import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { ingestRuntimeGateEvidence } from '../core/verification/index.js';

function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function readPackageVersion(): string {
  const pkgPath = join(process.cwd(), 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function getLatestIntegrityArtifact(): { path: string; sha256: string; createdAt: string } | undefined {
  const dir = join(process.cwd(), 'artifacts', 'integrity-snapshots');
  if (!existsSync(dir)) return undefined;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();

  if (files.length === 0) return undefined;

  const latest = join(dir, files[files.length - 1]);
  const content = readFileSync(latest);
  return {
    path: latest,
    sha256: sha256(content),
    createdAt: new Date().toISOString(),
  };
}

function stableJson(input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = input[key];
  return JSON.stringify(out);
}

async function main(): Promise<void> {
  const projectId = process.argv[2] ?? 'proj_c0d3e9a1f200';
  const policyBundleId = process.argv[3] ?? 'verification-gate-policy-v1';

  const started = Date.now();
  const ranAt = new Date(started).toISOString();

  const doneCheck = spawnSync('npm', ['run', 'done-check'], {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  const ended = Date.now();
  const durationMs = Math.max(0, ended - started);
  const ok = doneCheck.status === 0;

  const headSha = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const worktreeRaw = `${git(['status', '--porcelain'])}\n--unstaged--\n${git(['diff', '--binary', 'HEAD'])}\n--staged--\n${git(['diff', '--binary', '--cached'])}`;
  const isDirty = worktreeRaw.split('\n')[0].trim().length > 0;
  const diffHash = `sha256:${sha256(worktreeRaw)}`;
  const capturedAt = new Date().toISOString();

  const gateDecisionSeed = {
    projectId,
    gateName: 'done-check',
    result: ok ? 'pass' : 'fail',
    evaluatedAt: capturedAt,
    policyBundleId,
    headSha,
    branch,
    isDirty,
    diffHash,
    durationMs,
  };

  const externalContextSnapshotRef = `ctx:${sha256(stableJson(gateDecisionSeed)).slice(0, 32)}`;
  const decisionHash = `sha256:${sha256(stableJson({ ...gateDecisionSeed, externalContextSnapshotRef }))}`;

  const artifact = getLatestIntegrityArtifact();
  const artifactHash = artifact ? `sha256:${artifact.sha256}` : undefined;

  const runId = `vr:${projectId}:done-check:${started}`;

  const ingestResult = await ingestRuntimeGateEvidence({
    projectId,
    verificationRun: {
      runId,
      ranAt,
      tool: 'done-check',
      toolVersion: readPackageVersion(),
      ok,
      durationMs,
      artifactHash,
      decisionHash,
    },
    gateDecision: {
      gateName: 'done-check',
      result: ok ? 'pass' : 'fail',
      evaluatedAt: capturedAt,
      policyBundleId,
      externalContextSnapshotRef,
      decisionHash,
    },
    commitSnapshot: {
      headSha,
      branch,
      capturedAt,
    },
    workingTreeSnapshot: {
      isDirty,
      diffHash,
      capturedAt,
    },
    artifact,
  });

  console.log(
    JSON.stringify({
      ok,
      projectId,
      runId,
      headSha,
      branch,
      isDirty,
      diffHash,
      durationMs,
      artifactPath: artifact?.path,
      artifactHash,
      decisionHash,
      ingestResult,
    }),
  );

  process.exit(doneCheck.status ?? (ok ? 0 : 1));
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
