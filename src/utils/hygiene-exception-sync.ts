import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';
import neo4j from 'neo4j-driver';

dotenv.config();

const PROJECT_ID = process.env.PROJECT_ID ?? 'proj_c0d3e9a1f200';
const DEFAULT_PATH = process.env.HYGIENE_EXCEPTION_FILE ?? path.resolve(process.cwd(), 'config', 'hygiene-exceptions.json');

interface ExceptionSpec {
  id?: string;
  name: string;
  controlCode: string;
  exceptionType: 'standing_waiver' | 'emergency_bypass';
  reason: string;
  approver: string;
  ticketRef?: string;
  scope?: string;
  scopePattern?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  startsAt?: string;
  expiresAt: string;
  decisionHash?: string;
  remediationLink?: string;
  reviewCadenceDays?: number;
  status?: 'active' | 'revoked';
}

async function loadSpecs(filePath: string): Promise<ExceptionSpec[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ExceptionSpec[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stableId(projectId: string, controlCode: string, name: string, expiresAt: string): string {
  const base = `${projectId}:${controlCode}:${name}:${expiresAt}`;
  const hash = crypto.createHash('sha256').update(base).digest('hex').slice(0, 16);
  return `hygiene-exception:${hash}`;
}

async function main(): Promise<void> {
  const specs = await loadSpecs(DEFAULT_PATH);

  const driver = neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? 'codegraph'),
  );
  const session = driver.session();

  try {
    const nowIso = new Date().toISOString();

    await session.run(
      `MERGE (policy:CodeNode:HygieneExceptionPolicy {id: $id})
       SET policy.projectId = $projectId,
           policy.coreType = 'HygieneExceptionPolicy',
           policy.name = 'Hygiene exception governance policy',
           policy.version = $version,
           policy.requires = $requires,
           policy.types = $types,
           policy.defaultReviewCadenceDays = $defaultReviewCadenceDays,
           policy.updatedAt = datetime($updatedAt)
       WITH policy
       MATCH (d:HygieneDomain {id: $domainId})
       MERGE (d)-[:DEFINES_EXCEPTION_POLICY]->(policy)`,
      {
        id: `hygiene-exception-policy:${PROJECT_ID}:v1`,
        projectId: PROJECT_ID,
        version: 'v1',
        requires: ['reason', 'approver', 'expiresAt', 'scope or scopePattern', 'decisionHash'],
        types: ['standing_waiver', 'emergency_bypass'],
        defaultReviewCadenceDays: 14,
        updatedAt: nowIso,
        domainId: `hygiene-domain:${PROJECT_ID}`,
      },
    );

    let createdOrUpdated = 0;
    for (const spec of specs) {
      const id = spec.id?.trim() || stableId(PROJECT_ID, spec.controlCode, spec.name, spec.expiresAt);

      await session.run(
        `MERGE (e:CodeNode:HygieneException {id: $id})
         SET e.projectId = $projectId,
             e.coreType = 'HygieneException',
             e.name = $name,
             e.controlCode = $controlCode,
             e.exceptionType = $exceptionType,
             e.reason = $reason,
             e.approver = $approver,
             e.ticketRef = $ticketRef,
             e.scope = $scope,
             e.scopePattern = $scopePattern,
             e.riskLevel = $riskLevel,
             e.startsAt = CASE WHEN $startsAt IS NULL THEN NULL ELSE datetime($startsAt) END,
             e.expiresAt = datetime($expiresAt),
             e.decisionHash = $decisionHash,
             e.remediationLink = $remediationLink,
             e.reviewCadenceDays = $reviewCadenceDays,
             e.status = $status,
             e.updatedAt = datetime($updatedAt)
         WITH e
         MATCH (c:HygieneControl {projectId: $projectId, code: $controlCode})
         MERGE (e)-[:WAIVES]->(c)
         WITH e
         MATCH (policy:HygieneExceptionPolicy {id: $policyId})
         MERGE (policy)-[:GOVERNS]->(e)`,
        {
          id,
          projectId: PROJECT_ID,
          name: spec.name,
          controlCode: spec.controlCode,
          exceptionType: spec.exceptionType,
          reason: spec.reason,
          approver: spec.approver,
          ticketRef: spec.ticketRef ?? null,
          scope: spec.scope ?? null,
          scopePattern: spec.scopePattern ?? null,
          riskLevel: spec.riskLevel ?? 'medium',
          startsAt: spec.startsAt ?? null,
          expiresAt: spec.expiresAt,
          decisionHash: spec.decisionHash ?? `manual:${id}`,
          remediationLink: spec.remediationLink ?? null,
          reviewCadenceDays: spec.reviewCadenceDays ?? 14,
          status: spec.status ?? 'active',
          updatedAt: nowIso,
          policyId: `hygiene-exception-policy:${PROJECT_ID}:v1`,
        },
      );
      createdOrUpdated += 1;
    }

    console.log(
      JSON.stringify({
        ok: true,
        projectId: PROJECT_ID,
        exceptionFile: DEFAULT_PATH,
        exceptionsLoaded: specs.length,
        exceptionsUpserted: createdOrUpdated,
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
