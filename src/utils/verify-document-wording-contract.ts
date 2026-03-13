import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const planProjectId = process.argv[2] ?? 'plan_codegraph';
  const neo4j = new Neo4jService();

  try {
    const stateRows = (await neo4j.run(
      `MATCH (t:Task {projectId: $planProjectId})
       WHERE t.status = 'done'
         AND toLower(coalesce(t.name,'')) CONTAINS 'document'
         AND (toLower(coalesce(t.name,'')) CONTAINS 'materializ' OR toLower(coalesce(t.name,'')) CONTAINS 'witness')
       WITH count(t) AS doneMaterializationTasks
       OPTIONAL MATCH (p:Project {projectType:'document'})
       WITH doneMaterializationTasks, count(p) AS documentProjectCount
       OPTIONAL MATCH (w:DocumentWitness)
       RETURN doneMaterializationTasks, documentProjectCount, count(w) AS witnessCount`,
      { planProjectId },
    )) as Array<Record<string, unknown>>;

    const row = stateRows[0] ?? {};
    const doneMaterializationTasks = toNum(row.doneMaterializationTasks);
    const documentProjectCount = toNum(row.documentProjectCount);
    const witnessCount = toNum(row.witnessCount);

    const invariantRed =
      doneMaterializationTasks > 0 && (documentProjectCount <= 0 || witnessCount <= 0);

    const forbiddenRows = (await neo4j.run(
      `MATCH (c:Claim {projectId: $planProjectId})
       WHERE toLower(coalesce(c.statement, '')) CONTAINS 'document layer complete'
       RETURN c.claimId AS claimId, c.statement AS statement
       ORDER BY c.claimId`,
      { planProjectId },
    )) as Array<Record<string, unknown>>;

    const forbiddenCount = forbiddenRows.length;
    const forbiddenTriggered = invariantRed && forbiddenCount > 0;

    const payload = {
      ok: true,
      planProjectId,
      invariantRed,
      doneMaterializationTasks,
      documentProjectCount,
      witnessCount,
      allowedClaim:
        'document adapter plumbing + IR ingestion proven (canonical materialization pending)',
      forbiddenPhrase: 'document layer complete',
      forbiddenCount,
      forbiddenTriggered,
      status: forbiddenTriggered ? 'violation' : invariantRed ? 'restricted' : 'open',
      generatedAt: new Date().toISOString(),
    };

    const dir = join(process.cwd(), 'artifacts', 'document-wording-contract');
    mkdirSync(dir, { recursive: true });
    const ts = payload.generatedAt.replace(/[:.]/g, '-');
    const outPath = join(dir, `${ts}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));

    console.log(JSON.stringify({ ...payload, outPath }));

    if (forbiddenTriggered) {
      process.exit(1);
    }
  } finally {
    await neo4j.close();
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
