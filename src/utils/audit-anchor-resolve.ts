import { execFileSync } from 'node:child_process';
import fs from 'fs';
import path from 'node:path';

interface AnchorPair {
  label: string;
  codegraphCommit: string;
  workspaceCommit: string;
  updatedAt?: string;
  note?: string;
}

interface AnchorPairFile {
  current?: string;
  pairs?: Record<string, AnchorPair>;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const match = process.argv.find((x) => x.startsWith(`${name}=`));
  if (match) return match.slice(name.length + 1);
  return undefined;
}

function gitCommitExists(repoPath: string, sha: string): boolean {
  try {
    execFileSync('git', ['-C', repoPath, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const codegraphRepo = process.cwd();
  const workspaceRepo = path.resolve(arg('--workspaceRepo') ?? path.join(codegraphRepo, '..'));
  const configPath = path.resolve(arg('--config') ?? path.join(codegraphRepo, 'config', 'audit-anchor-pairs.json'));

  if (!fs.existsSync(configPath)) {
    throw new Error(`Anchor pair config not found: ${configPath}`);
  }

  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AnchorPairFile;
  const pairs = cfg.pairs ?? {};

  const label = arg('--label') ?? cfg.current;
  if (!label || !pairs[label]) {
    throw new Error(`Anchor label not found: ${label ?? '(none)'}`);
  }

  const pair = pairs[label];
  const codegraphExists = gitCommitExists(codegraphRepo, pair.codegraphCommit);
  const workspaceExists = gitCommitExists(workspaceRepo, pair.workspaceCommit);

  const payload = {
    ok: codegraphExists && workspaceExists,
    label: pair.label,
    codegraphRepo,
    workspaceRepo,
    codegraphCommit: pair.codegraphCommit,
    workspaceCommit: pair.workspaceCommit,
    codegraphExists,
    workspaceExists,
    updatedAt: pair.updatedAt ?? null,
    note: pair.note ?? null,
    configPath,
  };

  console.log(JSON.stringify(payload));

  if (!payload.ok && !hasArg('--best-effort')) process.exit(1);
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
