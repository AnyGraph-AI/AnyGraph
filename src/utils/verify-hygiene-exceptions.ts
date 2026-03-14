import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const ENFORCE = String(process.env.HYGIENE_EXCEPTION_ENFORCE ?? 'false').toLowerCase() === 'true';

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
  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const rows = await session.run(
      `MATCH (e:HygieneException {projectId: $projectId})-[:WAIVES]->(c:HygieneControl {projectId: $projectId})
       WHERE coalesce(e.status, 'active') = 'active'
       RETURN e.id AS id,
              e.name AS name,
              e.exceptionType AS exceptionType,
              e.expiresAt AS expiresAt,
              e.decisionHash AS decisionHash,
              e.approver AS approver,
              e.scope AS scope,
              e.scopePattern AS scopePattern,
              e.ticketRef AS ticketRef,
              e.remediationLink AS remediationLink,
              c.code AS controlCode,
              c.name AS controlName`,
      { projectId: PROJECT_ID },
    );

    const now = new Date();
    const expired: Array<Record<string, unknown>> = [];
    const invalid: Array<Record<string, unknown>> = [];

    for (const r of rows.records) {
      const id = String(r.get('id'));
      const name = String(r.get('name'));
      const exceptionType = String(r.get('exceptionType') ?? '');
      const expiresAtStr = String(r.get('expiresAt') ?? '');
      const decisionHash = String(r.get('decisionHash') ?? '');
      const approver = String(r.get('approver') ?? '');
      const scope = String(r.get('scope') ?? '');
      const scopePattern = String(r.get('scopePattern') ?? '');
      const ticketRef = String(r.get('ticketRef') ?? '');
      const controlCode = String(r.get('controlCode'));

      const expiresAt = new Date(expiresAtStr);
      const missingRequired = !decisionHash || !approver || (!scope && !scopePattern);
      const badType = exceptionType !== 'standing_waiver' && exceptionType !== 'emergency_bypass';

      if (missingRequired || badType) {
        invalid.push({ id, name, controlCode, missingRequired, badType, exceptionType });
      }

      if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
        expired.push({ id, name, controlCode, expiresAt: expiresAtStr, ticketRef });
      }
    }

    await session.run(
      `MATCH (v:HygieneViolation {projectId: $projectId, violationType: 'exception_hygiene'}) DETACH DELETE v`,
      { projectId: PROJECT_ID },
    );

    for (const e of expired) {
      const id = `hygiene-violation:${PROJECT_ID}:exception:expired:${sha(String(e.id))}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'exception_hygiene',
             v.subtype = 'expired_exception',
             v.severity = 'high',
             v.mode = 'advisory',
             v.name = $name,
             v.detectedAt = datetime($detectedAt)
         WITH v
         MATCH (e:HygieneException {id: $exceptionId})
         MERGE (v)-[:WAIVES]->(e)`,
        {
          id,
          projectId: PROJECT_ID,
          name: `Expired hygiene exception: ${String(e.name)}`,
          detectedAt: new Date().toISOString(),
          exceptionId: String(e.id),
        },
      );
    }

    for (const e of invalid) {
      const id = `hygiene-violation:${PROJECT_ID}:exception:invalid:${sha(String(e.id))}`;
      await session.run(
        `MERGE (v:CodeNode:HygieneViolation {id: $id})
         SET v.projectId = $projectId,
             v.coreType = 'HygieneViolation',
             v.violationType = 'exception_hygiene',
             v.subtype = 'invalid_exception_record',
             v.severity = 'high',
             v.mode = 'advisory',
             v.name = $name,
             v.detectedAt = datetime($detectedAt)
         WITH v
         MATCH (e:HygieneException {id: $exceptionId})
         MERGE (v)-[:WAIVES]->(e)`,
        {
          id,
          projectId: PROJECT_ID,
          name: `Invalid hygiene exception record: ${String(e.name)}`,
          detectedAt: new Date().toISOString(),
          exceptionId: String(e.id),
        },
      );
    }

    const debtRes = await session.run(
      `MATCH (e:HygieneException {projectId: $projectId})-[:WAIVES]->(c:HygieneControl {projectId: $projectId})
       WHERE coalesce(e.status, 'active') = 'active'
       RETURN c.code AS controlCode,
              count(e) AS totalActive,
              sum(CASE WHEN e.expiresAt <= datetime() THEN 1 ELSE 0 END) AS expiredActive`,
      { projectId: PROJECT_ID },
    );

    const debtByControl = debtRes.records.map((r) => ({
      controlCode: String(r.get('controlCode')),
      totalActive: toNum(r.get('totalActive')),
      expiredActive: toNum(r.get('expiredActive')),
    }));

    const snapshotPayload = {
      exceptionCount: rows.records.length,
      expiredCount: expired.length,
      invalidCount: invalid.length,
      debtByControl,
    };

    const snapshotId = `hygiene-metric:${PROJECT_ID}:exception:${Date.now()}`;
    await session.run(
      `MERGE (m:CodeNode:HygieneMetricSnapshot {id: $id})
       SET m.projectId = $projectId,
           m.coreType = 'HygieneMetricSnapshot',
           m.name = 'Exception hygiene debt snapshot',
           m.metricFamily = 'exception_hygiene',
           m.exceptionCount = $exceptionCount,
           m.expiredCount = $expiredCount,
           m.invalidCount = $invalidCount,
           m.payloadJson = $payloadJson,
           m.payloadHash = $payloadHash,
           m.timestamp = datetime($timestamp)
       WITH m
       MATCH (policy:HygieneExceptionPolicy {id: $policyId})
       MERGE (m)-[:MEASURED_BY]->(policy)`,
      {
        id: snapshotId,
        projectId: PROJECT_ID,
        exceptionCount: rows.records.length,
        expiredCount: expired.length,
        invalidCount: invalid.length,
        payloadJson: JSON.stringify(snapshotPayload),
        payloadHash: sha(JSON.stringify(snapshotPayload)),
        timestamp: new Date().toISOString(),
        policyId: `hygiene-exception-policy:${PROJECT_ID}:v1`,
      },
    );

    const out = {
      ok: ENFORCE ? expired.length === 0 && invalid.length === 0 : true,
      advisoryMode: !ENFORCE,
      enforce: ENFORCE,
      projectId: PROJECT_ID,
      exceptionCount: rows.records.length,
      expiredCount: expired.length,
      invalidCount: invalid.length,
      debtByControl,
      sampleExpired: expired.slice(0, 20),
      sampleInvalid: invalid.slice(0, 20),
      snapshotId,
    };

    const outDir = path.resolve(process.cwd(), 'artifacts', 'hygiene');
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `hygiene-exception-verify-${Date.now()}.json`);
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
