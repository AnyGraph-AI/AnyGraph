import { Neo4jService } from '../../../src/storage/neo4j/neo4j.service.js';

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

interface ScopedTaskRow {
  milestoneCode: string;
  milestoneName: string;
  taskId: string;
  taskName: string;
  taskStatus: string;
  lineNumber?: number;
  depCount: number;
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

function parseNoDependsException(taskName: string): { ok: boolean; reason?: string; expires?: string } {
  const match = taskName.match(/NO_DEPENDS_OK\s*\(([^|)]+)\|\s*expires\s*:\s*(\d{4}-\d{2}-\d{2})\)/i);
  if (!match) return { ok: false };
  return {
    ok: true,
    reason: match[1]?.trim(),
    expires: match[2]?.trim(),
  };
}

function isFutureDate(isoDate: string): boolean {
  const at = Date.parse(`${isoDate}T23:59:59Z`);
  if (!Number.isFinite(at)) return false;
  return at > Date.now();
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

    const scopedRows = (await neo4j.run(
      `MATCH (m:Milestone {projectId:'plan_codegraph'})<-[:PART_OF]-(t:Task {projectId:'plan_codegraph'})
       WHERE m.code STARTS WITH 'DL-' OR m.code STARTS WITH 'GM-'
       OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task {projectId:'plan_codegraph'})
       RETURN m.code AS milestoneCode,
              m.name AS milestoneName,
              t.id AS taskId,
              t.name AS taskName,
              t.status AS taskStatus,
              coalesce(t.lineNumber, 0) AS lineNumber,
              count(d) AS depCount
       ORDER BY milestoneCode, lineNumber, taskName`,
    )) as ScopedTaskRow[];

    const scopedByMilestone = new Map<string, ScopedTaskRow[]>();
    for (const row of scopedRows) {
      const key = row.milestoneCode;
      const list = scopedByMilestone.get(key) ?? [];
      list.push({ ...row, depCount: toNum(row.depCount) });
      scopedByMilestone.set(key, list);
    }

    let scopedTasksChecked = 0;
    let scopedMissingDepends = 0;
    let scopedExceptionCount = 0;
    const strictScopedDepends = String(process.env.STRICT_SCOPED_DEPENDS_ON ?? 'false').toLowerCase() === 'true';

    for (const [milestoneCode, tasks] of scopedByMilestone.entries()) {
      const sorted = [...tasks].sort((a, b) => toNum(a.lineNumber) - toNum(b.lineNumber));
      let starterAllowanceUsed = false;

      for (const task of sorted) {
        if ((task.taskStatus ?? '').trim().toLowerCase() === 'done') {
          continue;
        }

        scopedTasksChecked += 1;
        const exception = parseNoDependsException(task.taskName ?? '');

        if (exception.ok) {
          scopedExceptionCount += 1;
          if (!exception.reason || exception.reason.length < 3 || !exception.expires || !isFutureDate(exception.expires)) {
            violations.push({
              code: 'invalid_no_depends_exception',
              details: `${milestoneCode} ${task.taskId} task="${task.taskName}"`,
            });
          }
          continue;
        }

        if (toNum(task.depCount) <= 0) {
          if (!starterAllowanceUsed) {
            starterAllowanceUsed = true;
            continue;
          }

          scopedMissingDepends += 1;
          if (strictScopedDepends) {
            violations.push({
              code: 'scoped_task_missing_depends_on',
              details: `${milestoneCode} ${task.taskId} task="${task.taskName}"`,
            });
          }
        }
      }
    }

    const gm8EvidenceRows = (await neo4j.run(
      `MATCH (m:Milestone {projectId:'plan_codegraph', code:'GM-8'})<-[:PART_OF]-(t:Task {projectId:'plan_codegraph'})
       WHERE coalesce(t.status, 'planned') = 'done'
       OPTIONAL MATCH (t)-[r:HAS_CODE_EVIDENCE]->()
       WITH t, count(r) AS evidenceCount
       WHERE evidenceCount = 0
       RETURN t.id AS taskId, t.name AS taskName
       ORDER BY t.name`,
    )) as Array<{ taskId: string; taskName: string }>;

    for (const row of gm8EvidenceRows) {
      violations.push({
        code: 'gm8_done_missing_evidence',
        details: `GM-8 ${row.taskId} task="${row.taskName}"`,
      });
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
        scopedTasksChecked,
        scopedMissingDepends,
        scopedExceptionCount,
        strictScopedDepends,
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
