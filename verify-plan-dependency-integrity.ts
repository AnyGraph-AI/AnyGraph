import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

interface DependencyEdgeRow {
  project: string;
  relType: string;
  sourceId: string;
  sourceName?: string;
  targetId: string;
  targetName?: string;
  refType?: string;
  refValue?: string;
  rawRefValue?: string;
  tokenCount?: number;
  tokenIndex?: number;
}

function fail(message: string): never {
  console.error(`PLAN_DEPENDENCY_INTEGRITY_FAILED: ${message}`);
  process.exit(1);
}

function normalize(value?: string): string {
  return (value ?? '').trim().toLowerCase();
}

function toNum(value: unknown, fallback = 0): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<void> {
  const neo4j = new Neo4jService();

  try {
    const rows = (await neo4j.run(
      `MATCH (src)-[r:DEPENDS_ON|BLOCKS]->(dst)
       WHERE r.projectId STARTS WITH 'plan_'
         AND coalesce(r.refType, '') IN ['depends_on', 'blocks']
       RETURN r.projectId AS project,
              type(r) AS relType,
              src.id AS sourceId,
              src.name AS sourceName,
              dst.id AS targetId,
              dst.name AS targetName,
              r.refType AS refType,
              r.refValue AS refValue,
              r.rawRefValue AS rawRefValue,
              r.tokenCount AS tokenCount,
              r.tokenIndex AS tokenIndex
       ORDER BY project, relType, sourceId, targetId`,
    )) as DependencyEdgeRow[];

    const violations: Array<{ code: string; details: string }> = [];

    for (const row of rows) {
      const refValue = (row.refValue ?? '').trim();
      const rawRefValue = (row.rawRefValue ?? '').trim();
      const tokenCount = toNum(row.tokenCount, 0);
      const tokenIndex = toNum(row.tokenIndex, -1);
      const targetName = (row.targetName ?? '').trim();

      if (!refValue) {
        violations.push({
          code: 'missing_ref_value',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId}`,
        });
      }

      if (!rawRefValue) {
        violations.push({
          code: 'missing_raw_ref_value',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId}`,
        });
      }

      if (!Number.isFinite(tokenCount) || tokenCount <= 0) {
        violations.push({
          code: 'invalid_token_count',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId} tokenCount=${row.tokenCount}`,
        });
      }

      if (!Number.isFinite(tokenIndex) || tokenIndex < 0 || tokenIndex >= tokenCount) {
        violations.push({
          code: 'invalid_token_index',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId} tokenIndex=${row.tokenIndex}, tokenCount=${row.tokenCount}`,
        });
      }

      // If parser split into multiple tokens, the original directive must have semicolons.
      // This catches accidental comma-based fragmentation of task names.
      if (tokenCount > 1 && !rawRefValue.includes(';')) {
        violations.push({
          code: 'tokenized_without_semicolon',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId} raw="${rawRefValue}" tokenCount=${tokenCount}`,
        });
      }

      // tokenCount should match explicit semicolon tokenization of raw directive.
      const expectedTokenCount = rawRefValue
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean).length;

      if (expectedTokenCount > 0 && tokenCount !== expectedTokenCount) {
        violations.push({
          code: 'token_count_mismatch',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId} expected=${expectedTokenCount} actual=${tokenCount} raw="${rawRefValue}"`,
        });
      }

      // Basic fidelity check: token should map to target name unless milestone token shorthand is used.
      const nRef = normalize(refValue);
      const nTarget = normalize(targetName);
      const milestoneShorthand = /^m\d+(?:[-_: ].+)?$/i.test(refValue);

      if (!milestoneShorthand && nRef && nTarget && !nTarget.includes(nRef) && !nRef.includes(nTarget)) {
        violations.push({
          code: 'low_fidelity_ref_token',
          details: `${row.project} ${row.relType} ${row.sourceId} -> ${row.targetId} ref="${refValue}" target="${targetName}"`,
        });
      }
    }

    const maxViolations = Number(process.env.MAX_PLAN_DEPENDENCY_VIOLATIONS ?? 0);
    if (violations.length > maxViolations) {
      const sample = violations.slice(0, 10).map((v) => `${v.code}: ${v.details}`).join(' | ');
      fail(`violations=${violations.length} exceeds threshold=${maxViolations}. sample=${sample}`);
    }

    const countsByCode: Record<string, number> = {};
    for (const v of violations) countsByCode[v.code] = (countsByCode[v.code] ?? 0) + 1;

    console.log(
      JSON.stringify({
        ok: true,
        checkedEdges: rows.length,
        violations: violations.length,
        maxViolations,
        countsByCode,
      }),
    );
  } finally {
    await neo4j.getDriver().close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
