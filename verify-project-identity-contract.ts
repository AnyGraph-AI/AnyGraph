import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

type AllowedProjectType = 'code' | 'corpus' | 'plan' | 'document' | 'meta';
type AllowedSourceKind = 'parser' | 'plan-ingest' | 'corpus-ingest' | 'manual' | 'derived';
type AllowedStatus = 'active' | 'paused' | 'archived' | 'error';

interface Violation {
  projectId: string;
  reason: string;
}

const PROJECT_ID_REGEX = /^(proj|plan)_[a-z0-9_]+$/;
const ALLOWED_PROJECT_TYPES = new Set<AllowedProjectType>(['code', 'corpus', 'plan', 'document', 'meta']);
const ALLOWED_SOURCE_KINDS = new Set<AllowedSourceKind>(['parser', 'plan-ingest', 'corpus-ingest', 'manual', 'derived']);
const ALLOWED_STATUS = new Set<AllowedStatus>(['active', 'paused', 'archived', 'error']);

function fail(message: string): never {
  console.error(`PROJECT_IDENTITY_CONTRACT_FAILED: ${message}`);
  process.exit(1);
}

function toNum(value: unknown): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function str(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (p:Project)
       WHERE p.projectId IS NOT NULL
       RETURN
         p.projectId AS projectId,
         p.displayName AS displayName,
         p.projectType AS projectType,
         p.sourceKind AS sourceKind,
         p.status AS status,
         p.updatedAt AS updatedAt,
         p.nodeCount AS nodeCount,
         p.edgeCount AS edgeCount
       ORDER BY p.projectId`,
    )) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      fail('No :Project nodes found.');
    }

    const violations: Violation[] = [];

    for (const row of rows) {
      const projectId = str(row.projectId);
      const displayName = str(row.displayName);
      const projectType = str(row.projectType) as AllowedProjectType;
      const sourceKind = str(row.sourceKind) as AllowedSourceKind;
      const status = str(row.status) as AllowedStatus;
      const updatedAt = str(row.updatedAt);
      const nodeCount = toNum(row.nodeCount);
      const edgeCount = toNum(row.edgeCount);

      if (!PROJECT_ID_REGEX.test(projectId)) {
        violations.push({ projectId, reason: `invalid projectId format (${projectId})` });
      }
      if (!displayName) {
        violations.push({ projectId, reason: 'missing displayName' });
      }
      if (!ALLOWED_PROJECT_TYPES.has(projectType)) {
        violations.push({ projectId, reason: `invalid projectType (${projectType || 'empty'})` });
      }
      if (!ALLOWED_SOURCE_KINDS.has(sourceKind)) {
        violations.push({ projectId, reason: `invalid sourceKind (${sourceKind || 'empty'})` });
      }
      if (!ALLOWED_STATUS.has(status)) {
        violations.push({ projectId, reason: `invalid status (${status || 'empty'})` });
      }
      if (!updatedAt || !isIsoTimestamp(updatedAt)) {
        violations.push({ projectId, reason: `invalid updatedAt (${updatedAt || 'empty'})` });
      }
      if (!Number.isInteger(nodeCount) || nodeCount < 0) {
        violations.push({ projectId, reason: `invalid nodeCount (${String(row.nodeCount)})` });
      }
      if (!Number.isInteger(edgeCount) || edgeCount < 0) {
        violations.push({ projectId, reason: `invalid edgeCount (${String(row.edgeCount)})` });
      }
    }

    if (violations.length > 0) {
      const preview = violations
        .slice(0, 20)
        .map((v) => `${v.projectId}: ${v.reason}`)
        .join('; ');
      fail(`Found ${violations.length} identity-contract violation(s). ${preview}`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        checkedProjects: rows.length,
        requiredFields: ['projectId', 'displayName', 'projectType', 'sourceKind', 'status', 'updatedAt', 'nodeCount', 'edgeCount'],
        enums: {
          projectType: Array.from(ALLOWED_PROJECT_TYPES),
          sourceKind: Array.from(ALLOWED_SOURCE_KINDS),
          status: Array.from(ALLOWED_STATUS),
        },
      }),
    );
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
