import crypto from 'node:crypto';
import path from 'node:path';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

import { classifyOwner, isCriticalRelativePath, loadCodeowners, matchesCodeownersPattern, toRelative } from './hygiene-ownership-lib.js';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/jonathan/.openclaw/workspace/codegraph';
const REVIEW_CADENCE_DAYS = Number(process.env.OWNERSHIP_REVIEW_CADENCE_DAYS ?? '30');

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const codeowners = await loadCodeowners(REPO_ROOT);
    if (!codeowners.path || codeowners.entries.length === 0) {
      throw new Error(`CODEOWNERS missing or empty under ${REPO_ROOT}`);
    }

    const sourceFilesResult = await session.run(
      `MATCH (sf:SourceFile {projectId: $projectId})
       RETURN sf.id AS id, sf.filePath AS filePath`,
      { projectId: PROJECT_ID },
    );

    const sourceFiles = sourceFilesResult.records.map((r) => {
      const filePath = String(r.get('filePath'));
      return {
        id: String(r.get('id')),
        filePath,
        relativePath: toRelative(REPO_ROOT, filePath),
      };
    });

    const nowIso = new Date().toISOString();

    // clean previously synced ownership scopes for this project
    await session.run(
      `MATCH (s:OwnershipScope {projectId: $projectId, source: 'CODEOWNERS'}) DETACH DELETE s`,
      { projectId: PROJECT_ID },
    );

    // remove prior HAS_OWNER assignments (ownership hygiene layer only)
    await session.run(
      `MATCH (:Owner {projectId: $projectId})-[r:HAS_OWNER]->(:SourceFile {projectId: $projectId}) DELETE r`,
      { projectId: PROJECT_ID },
    );

    let scopesCreated = 0;
    let ownerNodesTouched = 0;
    let fileAssignments = 0;

    for (const entry of codeowners.entries) {
      const scopeId = `ownership-scope:${PROJECT_ID}:${sha(`${entry.pattern}:${entry.line}`)}`;
      const matchedFiles = sourceFiles.filter((sf) => matchesCodeownersPattern(entry.pattern, sf.relativePath));
      const criticalMatchCount = matchedFiles.filter((sf) => isCriticalRelativePath(sf.relativePath)).length;

      await session.run(
        `MERGE (s:CodeNode:OwnershipScope {id: $id})
         SET s.projectId = $projectId,
             s.coreType = 'OwnershipScope',
             s.name = $name,
             s.scopePattern = $scopePattern,
             s.scopeKind = 'codeowners_pattern',
             s.source = 'CODEOWNERS',
             s.sourceLine = $sourceLine,
             s.ownerVerifiedAt = datetime($ownerVerifiedAt),
             s.backupOwner = $backupOwner,
             s.escalationPath = $escalationPath,
             s.reviewCadenceDays = $reviewCadenceDays,
             s.criticalMatchCount = $criticalMatchCount,
             s.updatedAt = datetime($updatedAt)`,
        {
          id: scopeId,
          projectId: PROJECT_ID,
          name: `Ownership scope ${entry.pattern}`,
          scopePattern: entry.pattern,
          sourceLine: entry.line,
          ownerVerifiedAt: nowIso,
          backupOwner: null,
          escalationPath: 'repo-admin',
          reviewCadenceDays: REVIEW_CADENCE_DAYS,
          criticalMatchCount,
          updatedAt: nowIso,
        },
      );
      scopesCreated += 1;

      for (const ownerHandle of entry.owners) {
        const ownerType = classifyOwner(ownerHandle);
        const ownerId = `owner:${PROJECT_ID}:${sha(ownerHandle.toLowerCase())}`;
        await session.run(
          `MERGE (o:CodeNode:Owner {id: $ownerId})
           SET o.projectId = $projectId,
               o.coreType = 'Owner',
               o.name = $name,
               o.handle = $handle,
               o.ownerType = $ownerType,
               o.ownerVerifiedAt = datetime($ownerVerifiedAt),
               o.reviewCadenceDays = $reviewCadenceDays,
               o.updatedAt = datetime($updatedAt)
           WITH o
           MATCH (s:OwnershipScope {id: $scopeId})
           MERGE (o)-[:OWNS_SCOPE]->(s)`,
          {
            ownerId,
            projectId: PROJECT_ID,
            name: ownerHandle.replace(/^@/, ''),
            handle: ownerHandle,
            ownerType,
            ownerVerifiedAt: nowIso,
            reviewCadenceDays: REVIEW_CADENCE_DAYS,
            updatedAt: nowIso,
            scopeId,
          },
        );
        ownerNodesTouched += 1;
      }

      for (const sf of matchedFiles) {
        await session.run(
          `MATCH (s:OwnershipScope {id: $scopeId})
           MATCH (f:SourceFile {id: $fileId, projectId: $projectId})
           MERGE (s)-[:APPLIES_TO]->(f)
           WITH s, f
           MATCH (o:Owner {projectId: $projectId})-[:OWNS_SCOPE]->(s)
           MERGE (o)-[:HAS_OWNER]->(f)`,
          {
            scopeId,
            fileId: sf.id,
            projectId: PROJECT_ID,
          },
        );
        fileAssignments += 1;
      }
    }

    // bind B2 control to ownership scopes
    await session.run(
      `MATCH (c:HygieneControl {projectId: $projectId, code: 'B2'})
       MATCH (s:OwnershipScope {projectId: $projectId, source: 'CODEOWNERS'})
       MERGE (c)-[:APPLIES_TO]->(s)`,
      { projectId: PROJECT_ID },
    );

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PROJECT_ID,
        repoRoot: REPO_ROOT,
        codeownersPath: path.relative(REPO_ROOT, codeowners.path),
        entries: codeowners.entries.length,
        scopesCreated,
        ownerNodesTouched,
        fileAssignments,
      }),
    );
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
