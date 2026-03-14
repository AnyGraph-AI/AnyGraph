import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

import { isCriticalRelativePath, loadCodeowners, toRelative } from './hygiene-ownership-lib.js';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/jonathan/.openclaw/workspace/codegraph';
const STALE_DAYS = Number(process.env.OWNERSHIP_STALE_DAYS ?? '45');

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const codeowners = await loadCodeowners(REPO_ROOT);

    const filesResult = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       OPTIONAL MATCH (sf)<-[:HAS_OWNER]-(o:Owner {projectId: $projectId})
       RETURN sf.id AS id, sf.filePath AS filePath, collect(DISTINCT o.handle) AS owners`,
      { projectId: PROJECT_ID },
    );

    const critical = filesResult.records
      .map((r) => ({
        id: String(r.get('id')),
        filePath: String(r.get('filePath')),
        relativePath: toRelative(REPO_ROOT, String(r.get('filePath'))),
        owners: (r.get('owners') as string[]).filter(Boolean),
      }))
      .filter((f) => isCriticalRelativePath(f.relativePath));

    const unownedCritical = critical.filter((f) => f.owners.length === 0);

    const staleResult = await session.run(
      `MATCH (s:OwnershipScope {projectId: $projectId, source: 'CODEOWNERS'})-[:APPLIES_TO]->(sf:SourceFile {projectId: $projectId})
       WHERE (
         sf.filePath CONTAINS '/src/core/'
         OR sf.filePath CONTAINS '/src/core/verification/'
         OR sf.filePath CONTAINS '/src/utils/verify-'
         OR sf.filePath ENDS WITH '/package.json'
         OR sf.filePath ENDS WITH '/.github/CODEOWNERS'
       )
       AND s.ownerVerifiedAt IS NOT NULL
       AND datetime(s.ownerVerifiedAt) < datetime() - duration({days: $staleDays})
       RETURN DISTINCT sf.filePath AS filePath, s.id AS scopeId, s.ownerVerifiedAt AS ownerVerifiedAt`,
      { projectId: PROJECT_ID, staleDays: STALE_DAYS },
    );

    const staleCritical = staleResult.records.map((r) => ({
      filePath: String(r.get('filePath')),
      scopeId: String(r.get('scopeId')),
      ownerVerifiedAt: String(r.get('ownerVerifiedAt')),
    }));

    // Clear prior ownership hygiene violations then recreate
    await session.run(
      `MATCH (v:HygieneViolation {projectId: $projectId, violationType: 'ownership_hygiene'}) DETACH DELETE v`,
      { projectId: PROJECT_ID },
    );

    let violationsCreated = 0;

    for (const file of unownedCritical) {
      const violationId = `hygiene-violation:${PROJECT_ID}:ownership:unowned:${sha(file.filePath)}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'ownership_hygiene',
             v.subtype = 'unowned_critical_path',
             v.severity = 'high',
             v.mode = 'advisory',
             v.filePath = $filePath,
             v.scope = $scope,
             v.detectedAt = datetime($detectedAt),
             v.name = $name
         WITH v
         MATCH (c:HygieneControl {projectId: $projectId, code: 'B2'})
         MERGE (v)-[:TRIGGERED_BY]->(c)`,
        {
          id: violationId,
          projectId: PROJECT_ID,
          filePath: file.filePath,
          scope: file.relativePath,
          detectedAt: new Date().toISOString(),
          name: `Unowned critical path: ${file.relativePath}`,
        },
      );
      violationsCreated += 1;
    }

    for (const stale of staleCritical) {
      const violationId = `hygiene-violation:${PROJECT_ID}:ownership:stale:${sha(stale.filePath)}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'ownership_hygiene',
             v.subtype = 'stale_owner_verification',
             v.severity = 'medium',
             v.mode = 'advisory',
             v.filePath = $filePath,
             v.scope = $scope,
             v.detectedAt = datetime($detectedAt),
             v.name = $name
         WITH v
         MATCH (c:HygieneControl {projectId: $projectId, code: 'B2'})
         MERGE (v)-[:TRIGGERED_BY]->(c)`,
        {
          id: violationId,
          projectId: PROJECT_ID,
          filePath: stale.filePath,
          scope: stale.scopeId,
          detectedAt: new Date().toISOString(),
          name: `Stale owner verification: ${stale.filePath}`,
        },
      );
      violationsCreated += 1;
    }

    const ownershipScopeCountRes = await session.run(
      `MATCH (s:OwnershipScope {projectId: $projectId, source: 'CODEOWNERS'}) RETURN count(s) AS c`,
      { projectId: PROJECT_ID },
    );
    const ownershipScopeCount = Number(ownershipScopeCountRes.records[0]?.get('c').toNumber?.() ?? ownershipScopeCountRes.records[0]?.get('c') ?? 0);

    const parityOk = Boolean(codeowners.path) && codeowners.entries.length > 0 && ownershipScopeCount >= codeowners.entries.length;

    const output = {
      ok: unownedCritical.length === 0,
      projectId: PROJECT_ID,
      repoRoot: REPO_ROOT,
      codeownersPath: codeowners.path ? path.relative(REPO_ROOT, codeowners.path) : null,
      codeownersEntries: codeowners.entries.length,
      ownershipScopeCount,
      parityOk,
      staleDays: STALE_DAYS,
      criticalFilesChecked: critical.length,
      unownedCriticalCount: unownedCritical.length,
      staleCriticalCount: staleCritical.length,
      violationsCreated,
      unownedCritical: unownedCritical.map((f) => f.relativePath),
      staleCritical: staleCritical.map((s) => s.filePath),
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await ensureDir(outDir);
    const outPath = path.join(outDir, `hygiene-ownership-verify-${Date.now()}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

    if (!output.ok) {
      console.error(JSON.stringify({ ...output, artifactPath: outPath }));
      process.exit(1);
    }

    console.log(JSON.stringify({ ...output, artifactPath: outPath }));
  } finally {
    await session.close();
    await driver.close();
  }
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
