import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Neo4jService } from '../storage/neo4j/neo4j.service.js';

interface AdvisoryRow {
  doneMaterializationTasks: unknown;
  documentProjectCount: unknown;
  witnessCount: unknown;
  claimsSupportedByWitness: unknown;
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (t:Task {projectId:'plan_codegraph'})
       WHERE t.status = 'done'
         AND toLower(coalesce(t.name,'')) CONTAINS 'document'
         AND (
           toLower(coalesce(t.name,'')) CONTAINS 'materializ'
           OR toLower(coalesce(t.name,'')) CONTAINS 'witness'
           OR toLower(coalesce(t.name,'')) CONTAINS 'project taxonomy'
           OR toLower(coalesce(t.name,'')) CONTAINS 'layer'
         )
       WITH count(t) AS doneMaterializationTasks
       OPTIONAL MATCH (p:Project {projectType:'document'})
       WITH doneMaterializationTasks, count(p) AS documentProjectCount
       OPTIONAL MATCH (w:DocumentWitness)
       WITH doneMaterializationTasks, documentProjectCount, count(w) AS witnessCount
       OPTIONAL MATCH (c:Claim)-[:SUPPORTED_BY]->(:DocumentWitness)
       RETURN doneMaterializationTasks,
              documentProjectCount,
              witnessCount,
              count(DISTINCT c) AS claimsSupportedByWitness`,
    )) as AdvisoryRow[];

    const raw = rows[0] ?? {
      doneMaterializationTasks: 0,
      documentProjectCount: 0,
      witnessCount: 0,
      claimsSupportedByWitness: 0,
    };

    const row = {
      doneMaterializationTasks: toNum(raw.doneMaterializationTasks),
      documentProjectCount: toNum(raw.documentProjectCount),
      witnessCount: toNum(raw.witnessCount),
      claimsSupportedByWitness: toNum(raw.claimsSupportedByWitness),
    };

    const advisoryOk =
      row.doneMaterializationTasks === 0 || (row.documentProjectCount > 0 && row.witnessCount > 0);

    const payload = {
      ok: true,
      advisoryOk,
      advisoryLevel: advisoryOk ? 'ok' : 'warn',
      ...row,
      note: advisoryOk
        ? 'Document witness advisory check passed (or no done materialization tasks yet).'
        : 'Document materialization tasks are marked done but canonical witness prerequisites are not satisfied.',
      generatedAt: new Date().toISOString(),
    };

    const dir = join(process.cwd(), 'artifacts', 'document-witness-advisory');
    mkdirSync(dir, { recursive: true });
    const ts = payload.generatedAt.replace(/[:.]/g, '-');
    const outPath = join(dir, `${ts}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, 'latest.json'), JSON.stringify(payload, null, 2));

    console.log(JSON.stringify({ ...payload, outPath }));
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
