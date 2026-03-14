import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const ENFORCE = String(process.env.HYGIENE_PROOF_ENFORCE ?? 'false').toLowerCase() === 'true';

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sha(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

interface Row {
  planProjectId: string;
  milestoneCode: string;
  milestoneFamily: string;
  taskId: string;
  taskName: string;
  evidenceEdgeCount: number;
}

async function main(): Promise<void> {
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const scopeRes = await session.run(
      `MATCH (s:ProofOfDoneScope {projectId: $projectId})
       RETURN s.id AS id, s.criticalMilestoneSelectors AS selectors
       ORDER BY s.updatedAt DESC
       LIMIT 1`,
      { projectId: PROJECT_ID },
    );
    if (!scopeRes.records.length) {
      throw new Error('ProofOfDoneScope missing; run hygiene:proof:scope:sync first');
    }

    const scopeId = String(scopeRes.records[0].get('id'));
    const selectors = (scopeRes.records[0].get('selectors') as string[]) ?? [];

    const rowsRaw = await session.run(
      `MATCH (m:Milestone)<-[:PART_OF]-(t:Task)
       WHERE t.status = 'done'
         AND m.code IS NOT NULL
         AND any(sel IN $selectors WHERE m.code STARTS WITH sel)
       OPTIONAL MATCH (t)-[e:HAS_CODE_EVIDENCE]->()
       WITH m, t, count(e) AS evidenceEdgeCount
       RETURN m.projectId AS planProjectId,
              m.code AS milestoneCode,
              split(m.code, '-')[0] AS milestoneFamily,
              t.id AS taskId,
              t.name AS taskName,
              evidenceEdgeCount`,
      { selectors },
    );

    const rows: Row[] = rowsRaw.records.map((r) => ({
      planProjectId: String(r.get('planProjectId')),
      milestoneCode: String(r.get('milestoneCode')),
      milestoneFamily: String(r.get('milestoneFamily')),
      taskId: String(r.get('taskId')),
      taskName: String(r.get('taskName')),
      evidenceEdgeCount: toNum(r.get('evidenceEdgeCount')),
    }));

    await session.run(
      `MATCH (v:HygieneViolation {projectId: $projectId, violationType: 'proof_of_done'}) DETACH DELETE v`,
      { projectId: PROJECT_ID },
    );

    const doneWithoutEvidence = rows.filter((r) => r.evidenceEdgeCount <= 0);

    for (const row of doneWithoutEvidence) {
      const id = `hygiene-violation:${PROJECT_ID}:proof:${sha(row.taskId)}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'proof_of_done',
             v.subtype = 'done_without_evidence',
             v.severity = 'high',
             v.mode = 'advisory',
             v.taskId = $taskId,
             v.taskName = $taskName,
             v.planProjectId = $planProjectId,
             v.milestoneCode = $milestoneCode,
             v.name = $name,
             v.detectedAt = datetime($detectedAt)
         WITH v
         MATCH (c:HygieneControl {projectId: $projectId, code: 'B1'})
         MERGE (v)-[:TRIGGERED_BY]->(c)`,
        {
          id,
          projectId: PROJECT_ID,
          taskId: row.taskId,
          taskName: row.taskName,
          planProjectId: row.planProjectId,
          milestoneCode: row.milestoneCode,
          name: `Done without evidence: ${row.milestoneCode} ${row.taskName}`,
          detectedAt: new Date().toISOString(),
        },
      );
    }

    const byProjectFamily = new Map<string, { totalDone: number; withEvidence: number }>();
    for (const row of rows) {
      const key = `${row.planProjectId}::${row.milestoneFamily}`;
      const agg = byProjectFamily.get(key) ?? { totalDone: 0, withEvidence: 0 };
      agg.totalDone += 1;
      if (row.evidenceEdgeCount > 0) agg.withEvidence += 1;
      byProjectFamily.set(key, agg);
    }

    const coverageRows = Array.from(byProjectFamily.entries()).map(([key, agg]) => {
      const [planProjectId, milestoneFamily] = key.split('::');
      const proofCoverage = agg.totalDone > 0 ? agg.withEvidence / agg.totalDone : 1;
      return {
        planProjectId,
        milestoneFamily,
        totalDone: agg.totalDone,
        withEvidence: agg.withEvidence,
        doneWithoutEvidence: agg.totalDone - agg.withEvidence,
        proofCoverage,
      };
    });

    const snapshotId = `hygiene-metric:${PROJECT_ID}:proof:${Date.now()}`;
    const payload = {
      selectorCount: selectors.length,
      coverageRows,
      doneTaskCount: rows.length,
      doneWithoutEvidenceCount: doneWithoutEvidence.length,
    };

    await session.run(
      `MERGE (m:CodeNode:HygieneMetricSnapshot {id: $id})
       SET m.projectId = $projectId,
           m.coreType = 'HygieneMetricSnapshot',
           m.name = 'Proof-of-done coverage snapshot',
           m.metricFamily = 'proof_of_done',
           m.selectorCount = $selectorCount,
           m.doneTaskCount = $doneTaskCount,
           m.doneWithoutEvidenceCount = $doneWithoutEvidenceCount,
           m.payloadJson = $payloadJson,
           m.payloadHash = $payloadHash,
           m.timestamp = datetime($timestamp)
       WITH m
       MATCH (s:ProofOfDoneScope {id: $scopeId})
       MERGE (m)-[:MEASURED_BY]->(s)`,
      {
        id: snapshotId,
        projectId: PROJECT_ID,
        selectorCount: selectors.length,
        doneTaskCount: rows.length,
        doneWithoutEvidenceCount: doneWithoutEvidence.length,
        payloadJson: JSON.stringify(payload),
        payloadHash: sha(JSON.stringify(payload)),
        timestamp: new Date().toISOString(),
        scopeId,
      },
    );

    const out = {
      ok: ENFORCE ? doneWithoutEvidence.length === 0 : true,
      projectId: PROJECT_ID,
      scopeId,
      selectors,
      doneTaskCount: rows.length,
      doneWithoutEvidenceCount: doneWithoutEvidence.length,
      coverageRows,
      snapshotId,
      sampleViolations: doneWithoutEvidence.slice(0, 20),
      advisoryMode: !ENFORCE,
      enforce: ENFORCE,
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `hygiene-proof-verify-${Date.now()}.json`);
    await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

    if (!out.ok) {
      console.error(JSON.stringify({ ...out, artifactPath: outPath }));
      process.exit(1);
    }

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
