import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

interface DuplicateRow {
  displayName: string;
  projectIds: string[];
  projectCount: number;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       WITH coalesce(nullif(trim(p.displayName), ''), p.projectId) AS displayName,
            collect(DISTINCT p.projectId) AS projectIds
       WHERE size(projectIds) > 1
       RETURN displayName, projectIds, size(projectIds) AS projectCount
       ORDER BY projectCount DESC, displayName`,
    )) as Array<Record<string, unknown>>;

    const duplicates: DuplicateRow[] = rows.map((row) => ({
      displayName: String(row.displayName ?? ''),
      projectIds: ((row.projectIds as string[] | undefined) ?? []).map((x) => String(x)),
      projectCount: toNum(row.projectCount),
    }));

    const outDir = join(process.cwd(), 'artifacts', 'project-registry');
    mkdirSync(outDir, { recursive: true });

    const generatedAt = new Date().toISOString();
    const outPath = join(outDir, `duplicate-display-names-${generatedAt.replace(/[:.]/g, '-')}.json`);
    const latestPath = join(outDir, 'duplicate-display-names-latest.json');

    const report = {
      ok: true,
      generatedAt,
      duplicateDisplayNameCount: duplicates.length,
      duplicates,
    };

    writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(latestPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(
      JSON.stringify({
        ok: true,
        duplicateDisplayNameCount: duplicates.length,
        outPath,
        latestPath,
      }),
    );
  } finally {
    await neo4j.close();
  }
}

// Guard: only run when executed directly (not imported by tests)
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  });
}
