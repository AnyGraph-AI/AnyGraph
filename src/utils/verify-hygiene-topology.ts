import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/jonathan/.openclaw/workspace/codegraph';

const EXCLUDE_DIRS = new Set(['.git']);
const GENERATED_PREFIXES = ['dist/', 'build/', 'coverage/'];
const THIRD_PARTY_PREFIXES = ['node_modules/'];
const GOVERNED_PREFIXES = ['src/', 'docs/', 'scripts/', 'config/', '.github/'];

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function normalizeRel(abs: string): string {
  return path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function extOf(rel: string): string {
  if (rel.endsWith('.gitignore')) return '.gitignore';
  if (path.basename(rel) === 'CODEOWNERS') return '.CODEOWNERS';
  const ext = path.extname(rel);
  return ext || '(none)';
}

async function walkFiles(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = normalizeRel(full);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      await walkFiles(full, files);
    } else if (e.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const manifestRes = await session.run(
      `MATCH (m:TopologyManifest {projectId: $projectId}) RETURN m ORDER BY m.updatedAt DESC LIMIT 1`,
      { projectId: PROJECT_ID },
    );
    if (manifestRes.records.length === 0) throw new Error(`TopologyManifest missing for ${PROJECT_ID}; run hygiene:topology:sync first`);

    const manifest = manifestRes.records[0].get('m').properties as Record<string, any>;
    const allowedExtensions: string[] = manifest.allowedExtensions ?? [];
    const forbiddenPatterns: string[] = manifest.forbiddenPatterns ?? [];
    const deprecatedPatterns: string[] = manifest.deprecatedPatterns ?? [];
    const maxPathLength = Number(manifest.maxPathLength ?? 180);
    const maxSourceFileBytes = Number(manifest.maxSourceFileBytes ?? 1048576);

    const exceptionRes = await session.run(
      `MATCH (e:HygieneException {projectId: $projectId})
       WHERE coalesce(e.controlFamily, '') IN ['topology_hygiene', 'path_hygiene', 'folder_hygiene']
         AND (e.expiresAt IS NULL OR datetime(e.expiresAt) > datetime())
       RETURN coalesce(e.scopePattern, e.scope, '') AS pattern`,
      { projectId: PROJECT_ID },
    );
    const exceptionPatterns = exceptionRes.records.map((r) => String(r.get('pattern'))).filter(Boolean);
    const exceptionRegex = exceptionPatterns.map(globToRegex);

    const files = await walkFiles(REPO_ROOT);

    const forbiddenRegex = forbiddenPatterns.map(globToRegex);
    const deprecatedRegex = deprecatedPatterns.map(globToRegex);

    const findings: Array<{ subtype: string; severity: string; rel: string; reason: string }> = [];

    for (const rel of files) {
      if (exceptionRegex.some((rx) => rx.test(rel))) continue;

      const isGenerated = GENERATED_PREFIXES.some((p) => rel.startsWith(p));
      const isThirdParty = THIRD_PARTY_PREFIXES.some((p) => rel.startsWith(p));
      const isGoverned = GOVERNED_PREFIXES.some((p) => rel.startsWith(p));

      if (forbiddenRegex.some((rx) => rx.test(rel))) {
        findings.push({ subtype: 'forbidden_path', severity: 'high', rel, reason: 'Matches forbidden topology pattern' });
      }
      if (deprecatedRegex.some((rx) => rx.test(rel))) {
        findings.push({ subtype: 'deprecated_path', severity: 'medium', rel, reason: 'Matches deprecated topology pattern' });
      }
      if (rel.length > maxPathLength) {
        findings.push({ subtype: 'path_length_exceeded', severity: 'medium', rel, reason: `Path length ${rel.length} exceeds ${maxPathLength}` });
      }

      if (!isGenerated && !isThirdParty && isGoverned) {
        const ext = extOf(rel);
        if (!allowedExtensions.includes(ext)) {
          findings.push({ subtype: 'extension_not_allowed', severity: 'low', rel, reason: `Extension ${ext} not in allowed list` });
        }
        const stat = await fs.stat(path.join(REPO_ROOT, rel));
        if (stat.size > maxSourceFileBytes) {
          findings.push({ subtype: 'file_size_exceeded', severity: 'medium', rel, reason: `File size ${stat.size} exceeds ${maxSourceFileBytes}` });
        }
      }
    }

    await session.run(
      `MATCH (v:HygieneViolation {projectId: $projectId, violationType: 'topology_hygiene'}) DETACH DELETE v`,
      { projectId: PROJECT_ID },
    );

    for (const f of findings) {
      const id = `hygiene-violation:${PROJECT_ID}:topology:${f.subtype}:${sha(f.rel)}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'topology_hygiene',
             v.subtype = $subtype,
             v.severity = $severity,
             v.mode = 'advisory',
             v.filePath = $filePath,
             v.name = $name,
             v.detectedAt = datetime($detectedAt)
         WITH v
         MATCH (d:HygieneDomain {id: $domainId})
         MERGE (v)-[:TRIGGERED_BY]->(d)`,
        {
          id,
          projectId: PROJECT_ID,
          subtype: f.subtype,
          severity: f.severity,
          filePath: path.join(REPO_ROOT, f.rel),
          name: `${f.subtype}: ${f.rel}`,
          detectedAt: new Date().toISOString(),
          domainId: `hygiene-domain:${PROJECT_ID}`,
        },
      );
    }

    const out = {
      ok: true,
      projectId: PROJECT_ID,
      filesScanned: files.length,
      findingsCount: findings.length,
      findingsBySubtype: findings.reduce<Record<string, number>>((acc, f) => {
        acc[f.subtype] = (acc[f.subtype] ?? 0) + 1;
        return acc;
      }, {}),
      exceptionPatterns,
      maxPathLength,
      maxSourceFileBytes,
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `hygiene-topology-verify-${Date.now()}.json`);
    await fs.writeFile(outPath, `${JSON.stringify({ ...out, sampleFindings: findings.slice(0, 25) }, null, 2)}\n`, 'utf8');

    console.log(JSON.stringify({ ...out, artifactPath: outPath }));
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
