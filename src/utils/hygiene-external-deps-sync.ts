/**
 * Sync external dependency inventory to graph.
 * Reads package.json for declared deps, cross-references with unresolved Import nodes
 * to produce ExternalDependency nodes with usage counts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/jonathan/.openclaw/workspace/codegraph';

// Node builtins (with and without node: prefix)
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
  'dgram', 'dns', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https',
  'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring',
  'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url',
  'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

function isBuiltin(mod: string): boolean {
  if (mod.startsWith('node:')) return true;
  return NODE_BUILTINS.has(mod);
}

function normalizePackageName(mod: string): string {
  // @scope/pkg/sub → @scope/pkg
  // pkg/sub → pkg
  if (mod.startsWith('@')) {
    const parts = mod.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : mod;
  }
  return mod.split('/')[0];
}

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function main(): Promise<void> {
  // Read package.json for declared deps
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkgRaw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  const declaredDeps: Record<string, string> = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };

  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    // Get all unresolved imports grouped by module specifier
    const importsRes = await session.run(
      `MATCH (i:Import {projectId: $projectId})
       WHERE NOT (i)-[:RESOLVES_TO]->()
       MATCH (sf:SourceFile)-[:CONTAINS]->(i)
       RETURN i.name AS mod, count(DISTINCT sf) AS fileCount, collect(DISTINCT sf.filePath) AS files`,
      { projectId: PROJECT_ID },
    );

    // Clean old ExternalDependency nodes
    await session.run(
      `MATCH (ed:ExternalDependency {projectId: $projectId}) DETACH DELETE ed`,
      { projectId: PROJECT_ID },
    );

    let builtinCount = 0;
    let externalCount = 0;
    let internalUnresolved = 0;
    const created: Array<{ name: string; kind: string; version: string | null; fileCount: number }> = [];

    for (const r of importsRes.records) {
      const mod = String(r.get('mod'));
      const fileCount = toNum(r.get('fileCount'));
      const files = (r.get('files') as string[]) ?? [];

      // Skip internal unresolved (relative paths)
      if (mod.startsWith('.') || mod.startsWith('/')) {
        internalUnresolved += 1;
        continue;
      }

      const builtin = isBuiltin(mod);
      const pkgName = builtin ? mod : normalizePackageName(mod);
      const kind = builtin ? 'builtin' : 'npm';
      const version = builtin ? null : (declaredDeps[pkgName] ?? null);

      const id = `ext-dep:${PROJECT_ID}:${sha(pkgName)}`;

      await session.run(
        `MERGE (ed:CodeNode:ExternalDependency {id: $id})
         SET ed.projectId = $projectId,
             ed.coreType = 'ExternalDependency',
             ed.name = $name,
             ed.packageName = $packageName,
             ed.kind = $kind,
             ed.declaredVersion = $version,
             ed.isDeclared = $isDeclared,
             ed.fileCount = $fileCount,
             ed.sampleFiles = $sampleFiles,
             ed.updatedAt = datetime($updatedAt)
         WITH ed
         MATCH (p:Project {projectId: $projectId})
         MERGE (p)-[:HAS_DEPENDENCY]->(ed)`,
        {
          id,
          projectId: PROJECT_ID,
          name: mod,
          packageName: pkgName,
          kind,
          version: version ?? null,
          isDeclared: version !== null || builtin,
          fileCount,
          sampleFiles: files.slice(0, 10),
          updatedAt: new Date().toISOString(),
        },
      );

      if (builtin) builtinCount += 1;
      else externalCount += 1;

      created.push({ name: pkgName, kind, version, fileCount });
    }

    // Flag undeclared deps (used but not in package.json and not builtin)
    const undeclared = created.filter((d) => d.kind === 'npm' && !declaredDeps[d.name]);

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PROJECT_ID,
        builtinCount,
        externalCount,
        internalUnresolved,
        totalCreated: created.length,
        undeclaredDeps: undeclared.map((d) => d.name),
        inventory: created.sort((a, b) => b.fileCount - a.fileCount),
      }),
    );
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
