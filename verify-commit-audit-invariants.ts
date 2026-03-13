#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { Neo4jService } from './src/storage/neo4j/neo4j.service.js';

type InvariantKey =
  | 'schema_integrity'
  | 'edge_taxonomy_integrity'
  | 'dependency_integrity'
  | 'parser_contract_integrity'
  | 'coverage_drift_guardrails'
  | 'recommendation_done_task_guard'
  | 'invariant_proof_completeness'
  | 'milestone_query_anchor_integrity'
  | 'dependency_distinct_guard'
  | 'null_status_visibility_guard'
  | 'readiness_semantics_contract'
  | 's6_baseline_output_contract'
  | 's5_trend_source_contract'
  | 'done_check_gate_command'
  | 'done_check_fail_closed'
  | 'governance_evidence_artifact_requirement'
  | 'stale_check_detector';

interface InvariantResult {
  key: InvariantKey;
  ok: boolean;
  summary: string;
  details: Record<string, unknown>;
}

interface SnapshotDelta {
  projectId: string;
  nodeCountDelta: number;
  edgeCountDelta: number;
  unresolvedLocalDelta: number;
  invariantViolationDelta: number;
  duplicateSourceSuspicionDelta: number;
}

interface CommitAuditReport {
  ok: boolean;
  generatedAt: string;
  baseRef: string;
  headRef: string;
  commitCount: number;
  changedFiles: string[];
  invariants: InvariantResult[];
  failingInvariantKeys: InvariantKey[];
  confidence: number;
  anomalyDeltas: SnapshotDelta[];
  roadmapTaskLinks: Array<{ invariant: InvariantKey; task: string; line: number }>;
}

const EXPECTED_GLOBAL_EDGE_TYPES = new Set<string>([
  'MENTIONS_PERSON',
  'NEXT_VERSE',
  'PART_OF',
  'SUPPORTED_BY',
  'CONTRADICTED_BY',
  'HAS_CODE_EVIDENCE',
  'BLOCKS',
]);

const KNOWN_SCOPE_DEBT_EDGE_TYPES = new Set<string>([
  'ORIGINATES_IN',
  'READS_STATE',
  'WRITES_STATE',
  'FOUND',
  'OWNED_BY',
  'BELONGS_TO_LAYER',
  'MEASURED',
  'POSSIBLE_CALL',
  'TESTED_BY',
]);

const ROADMAP_LINKS: Record<InvariantKey, Array<{ task: string; line: number }>> = {
  schema_integrity: [
    {
      task: 'Invariants v1: schema integrity, edge taxonomy integrity, dependency integrity, parser-contract integrity, coverage drift guardrails',
      line: 834,
    },
  ],
  edge_taxonomy_integrity: [
    {
      task: 'Invariants v1: schema integrity, edge taxonomy integrity, dependency integrity, parser-contract integrity, coverage drift guardrails',
      line: 834,
    },
  ],
  dependency_integrity: [
    { task: 'Add `verify-plan-dependency-integrity.ts` gate script', line: 827 },
    { task: 'Wire `plan:deps:verify` into `done-check`', line: 828 },
    { task: 'Add query contract metric for dependency integrity (Q9)', line: 829 },
  ],
  parser_contract_integrity: [
    {
      task: 'Invariants v1: schema integrity, edge taxonomy integrity, dependency integrity, parser-contract integrity, coverage drift guardrails',
      line: 834,
    },
  ],
  coverage_drift_guardrails: [
    {
      task: 'Invariants v1: schema integrity, edge taxonomy integrity, dependency integrity, parser-contract integrity, coverage drift guardrails',
      line: 834,
    },
  ],
  recommendation_done_task_guard: [
    {
      task: "Add commit-audit invariant: fail if recommendation engine proposes tasks with `status='done'` without freshness violation evidence",
      line: 874,
    },
  ],
  invariant_proof_completeness: [
    {
      task: 'Add commit-audit invariant: fail when invariant tasks are `done` but missing proof records',
      line: 876,
    },
  ],
  milestone_query_anchor_integrity: [
    {
      task: 'Add commit-audit invariant: fail if milestone status queries rely on line-range bucketing instead of `Task-[:PART_OF]->Milestone`',
      line: 906,
    },
  ],
  dependency_distinct_guard: [
    {
      task: 'Add commit-audit invariant: fail if canonical dependency blocker counts omit `DISTINCT`',
      line: 907,
    },
  ],
  null_status_visibility_guard: [
    {
      task: 'Add commit-audit invariant: fail if canonical status output omits `nullStatusCount`',
      line: 908,
    },
  ],
  readiness_semantics_contract: [
    {
      task: 'Add query contract rule: readiness semantics are defined only by `DEPENDS_ON` edges',
      line: 909,
    },
  ],
  s6_baseline_output_contract: [
    {
      task: 'Add commit-audit invariant for S6 output contract (`baselineRef` + `baselineTimestamp` required in canonical integrity verify output).',
      line: 72,
    },
  ],
  s5_trend_source_contract: [
    {
      task: 'Add commit-audit invariant for S5 trend-source contract (trend/status tooling must source from `IntegritySnapshot`, not ad-hoc file parsing).',
      line: 73,
    },
  ],
  done_check_gate_command: [
    {
      task: 'Add `done-check` gate command that runs governance + parity + integrity checks',
      line: 83,
    },
  ],
  done_check_fail_closed: [
    {
      task: 'Fail-closed behavior: check runner failure = gate failure',
      line: 84,
    },
  ],
  governance_evidence_artifact_requirement: [
    {
      task: 'Require evidence artifacts to close governance tasks',
      line: 85,
    },
  ],
  stale_check_detector: [
    {
      task: "Add stale-check detector (if integrity/parity checks haven't run in SLA window)",
      line: 86,
    },
  ],
};

function toNum(value: unknown, fallback = 0): number {
  const maybe = value as { toNumber?: () => number } | null | undefined;
  if (maybe?.toNumber) return maybe.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function getChangedFiles(baseRef: string, headRef: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}..${headRef}`], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getCommitCount(baseRef: string, headRef: string): number {
  const out = execFileSync('git', ['rev-list', '--count', `${baseRef}..${headRef}`], {
    encoding: 'utf8',
  }).trim();
  return Number(out || 0);
}

function readSnapshotDeltas(): SnapshotDelta[] {
  const dir = join(process.cwd(), 'artifacts', 'integrity-snapshots');
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort();
  } catch {
    return [];
  }

  // Need at least 2 snapshot files to compute deltas (cold-start: first snapshot has no baseline).
  if (files.length < 2) return [];

  const parseJsonl = (filePath: string): Array<Record<string, unknown>> =>
    readFileSync(filePath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

  const currRows = parseJsonl(join(dir, files[files.length - 1]));
  const prevRows = parseJsonl(join(dir, files[files.length - 2]));

  if (currRows.length === 0 || prevRows.length === 0) return [];

  const prevByProject = new Map<string, Record<string, unknown>>();
  for (const row of prevRows) prevByProject.set(String(row.projectId), row);

  const deltas: SnapshotDelta[] = [];
  for (const curr of currRows) {
    const projectId = String(curr.projectId ?? '');
    if (!projectId) continue;
    const prev = prevByProject.get(projectId) ?? {};

    const delta: SnapshotDelta = {
      projectId,
      nodeCountDelta: toNum(curr.nodeCount) - toNum(prev.nodeCount),
      edgeCountDelta: toNum(curr.edgeCount) - toNum(prev.edgeCount),
      unresolvedLocalDelta: toNum(curr.unresolvedLocalCount) - toNum(prev.unresolvedLocalCount),
      invariantViolationDelta: toNum(curr.invariantViolationCount) - toNum(prev.invariantViolationCount),
      duplicateSourceSuspicionDelta:
        toNum(curr.duplicateSourceSuspicionCount) - toNum(prev.duplicateSourceSuspicionCount),
    };

    if (
      delta.nodeCountDelta !== 0 ||
      delta.edgeCountDelta !== 0 ||
      delta.unresolvedLocalDelta !== 0 ||
      delta.invariantViolationDelta !== 0 ||
      delta.duplicateSourceSuspicionDelta !== 0
    ) {
      deltas.push(delta);
    }
  }

  return deltas;
}

async function checkSchemaIntegrity(neo4j: Neo4jService): Promise<InvariantResult> {
  const projectMissing = await neo4j.run(
    `MATCH (p:Project)
     WHERE p.projectId IS NULL OR trim(coalesce(p.projectId, '')) = '' OR trim(coalesce(p.name, '')) = ''
     RETURN count(p) AS c`,
  );

  const verificationMissing = await neo4j.run(
    `MATCH (v:VerificationRun)
     WHERE v.id IS NULL OR v.projectId IS NULL OR v.status IS NULL
     RETURN count(v) AS c`,
  );

  const projectMissingCount = toNum(projectMissing[0]?.c);
  const verificationMissingCount = toNum(verificationMissing[0]?.c);
  const total = projectMissingCount + verificationMissingCount;

  return {
    key: 'schema_integrity',
    ok: total === 0,
    summary: total === 0 ? 'Schema integrity checks passed.' : `Schema integrity violations: ${total}`,
    details: {
      projectMissingCount,
      verificationMissingCount,
      total,
    },
  };
}

async function checkEdgeTaxonomyIntegrity(neo4j: Neo4jService): Promise<InvariantResult> {
  const rows = (await neo4j.run(
    `MATCH ()-[r]->()
     WHERE r.projectId IS NULL
     RETURN type(r) AS edgeType, count(*) AS count
     ORDER BY count DESC`,
  )) as Array<Record<string, unknown>>;

  const unknown = rows.filter((r) => {
    const edgeType = String(r.edgeType ?? '');
    return !EXPECTED_GLOBAL_EDGE_TYPES.has(edgeType) && !KNOWN_SCOPE_DEBT_EDGE_TYPES.has(edgeType);
  });

  const scopeDebtRows = rows.filter((r) => KNOWN_SCOPE_DEBT_EDGE_TYPES.has(String(r.edgeType ?? '')));
  const scopeDebtTotal = scopeDebtRows.reduce((sum, row) => sum + toNum(row.count), 0);
  const maxScopeDebt = Number(process.env.MAX_UNSCOPED_SCOPE_DEBT ?? 0);

  const ok = unknown.length === 0 && scopeDebtTotal <= maxScopeDebt;

  return {
    key: 'edge_taxonomy_integrity',
    ok,
    summary: ok
      ? 'Edge taxonomy integrity checks passed.'
      : `Edge taxonomy failed (unknown=${unknown.length}, scopeDebt=${scopeDebtTotal}/${maxScopeDebt})`,
    details: {
      unknown,
      scopeDebtTotal,
      maxScopeDebt,
      totalUnscopedTypes: rows.length,
    },
  };
}

async function checkDependencyIntegrity(neo4j: Neo4jService): Promise<InvariantResult> {
  const rows = (await neo4j.run(
    `MATCH (src)-[r:DEPENDS_ON|BLOCKS]->(dst)
     WHERE r.projectId STARTS WITH 'plan_'
       AND coalesce(r.refType, '') IN ['depends_on', 'blocks']
     RETURN r.projectId AS projectId,
            src.id AS sourceId,
            dst.id AS targetId,
            dst.name AS targetName,
            r.refValue AS refValue,
            r.rawRefValue AS rawRefValue,
            r.tokenCount AS tokenCount,
            r.tokenIndex AS tokenIndex`,
  )) as Array<Record<string, unknown>>;

  let missingRawRefValue = 0;
  let missingRefValue = 0;
  let invalidTokenCount = 0;
  let invalidTokenIndex = 0;
  let tokenizedWithoutSemicolon = 0;
  let lowFidelityRefToken = 0;

  for (const row of rows) {
    const refValue = String(row.refValue ?? '').trim();
    const rawRefValue = String(row.rawRefValue ?? '').trim();
    const tokenCount = toNum(row.tokenCount, 0);
    const tokenIndex = toNum(row.tokenIndex, -1);
    const targetName = String(row.targetName ?? '').trim().toLowerCase();

    if (!rawRefValue) missingRawRefValue++;
    if (!refValue) missingRefValue++;
    if (tokenCount <= 0) invalidTokenCount++;
    if (tokenIndex < 0 || tokenIndex >= Math.max(1, tokenCount)) invalidTokenIndex++;
    if (tokenCount > 1 && !rawRefValue.includes(';')) tokenizedWithoutSemicolon++;

    const isMilestoneShorthand = /^m\d+(?:[-_: ].+)?$/i.test(refValue);
    const refNorm = refValue.toLowerCase();
    if (
      !isMilestoneShorthand &&
      refNorm &&
      targetName &&
      !targetName.includes(refNorm) &&
      !refNorm.includes(targetName)
    ) {
      lowFidelityRefToken++;
    }
  }

  const totalViolations =
    missingRawRefValue +
    missingRefValue +
    invalidTokenCount +
    invalidTokenIndex +
    tokenizedWithoutSemicolon +
    lowFidelityRefToken;

  return {
    key: 'dependency_integrity',
    ok: totalViolations === 0,
    summary:
      totalViolations === 0
        ? 'Dependency integrity checks passed.'
        : `Dependency integrity violations: ${totalViolations}`,
    details: {
      checkedEdges: rows.length,
      missingRawRefValue,
      missingRefValue,
      invalidTokenCount,
      invalidTokenIndex,
      tokenizedWithoutSemicolon,
      lowFidelityRefToken,
      totalViolations,
    },
  };
}

async function checkParserContractIntegrity(neo4j: Neo4jService): Promise<InvariantResult> {
  const contractNodes = await neo4j.run(`MATCH (c:ParserContract) RETURN count(c) AS c`);
  const stages = await neo4j.run(
    `MATCH (c:ParserContract {parserName: 'plan-parser'})
     RETURN collect(DISTINCT c.stage) AS stages, count(c) AS c`,
  );
  const edgeTypes = await neo4j.run(
    `MATCH (:ParserContract)-[r]->(:CodeNode)
     RETURN type(r) AS type, count(r) AS c`,
  );
  const funcs = await neo4j.run(
    `MATCH (c:ParserContract {parserName: 'plan-parser'})
     RETURN collect(DISTINCT c.functionName) AS funcs`,
  );

  const contractNodeCount = toNum(contractNodes[0]?.c);
  const stageList = ((stages[0]?.stages as string[] | undefined) ?? []).filter(Boolean);
  const funcList = ((funcs[0]?.funcs as string[] | undefined) ?? []).filter(Boolean);

  const requiredStages = ['parse', 'enrich', 'materialize'];
  const requiredEdgeTypes = [
    'NEXT_STAGE',
    'EMITS_NODE_TYPE',
    'EMITS_EDGE_TYPE',
    'READS_PLAN_FIELD',
    'MUTATES_TASK_FIELD',
  ];
  const requiredFuncs = ['parsePlanDirectory', 'enrichCrossDomain', 'ingestToNeo4j'];

  const edgeTypeCounts: Record<string, number> = {};
  for (const row of edgeTypes) edgeTypeCounts[String(row.type)] = toNum(row.c);

  const missingStages = requiredStages.filter((s) => !stageList.includes(s));
  const missingEdgeTypes = requiredEdgeTypes.filter((e) => (edgeTypeCounts[e] ?? 0) === 0);
  const missingFuncs = requiredFuncs.filter((f) => !funcList.includes(f));

  const ok =
    contractNodeCount > 0 &&
    missingStages.length === 0 &&
    missingEdgeTypes.length === 0 &&
    missingFuncs.length === 0;

  return {
    key: 'parser_contract_integrity',
    ok,
    summary: ok
      ? 'Parser contract integrity checks passed.'
      : `Parser contract integrity failed (missingStages=${missingStages.length}, missingEdgeTypes=${missingEdgeTypes.length}, missingFuncs=${missingFuncs.length})`,
    details: {
      contractNodeCount,
      stageList,
      edgeTypeCounts,
      funcList,
      missingStages,
      missingEdgeTypes,
      missingFuncs,
    },
  };
}

async function checkCoverageDriftGuardrails(
  neo4j: Neo4jService,
  changedFiles: string[],
): Promise<InvariantResult> {
  const changedSourceFiles = changedFiles.filter((f) => f.startsWith('src/') && f.endsWith('.ts'));
  const changedPlanFiles = changedFiles.filter((f) => f.startsWith('plans/') && f.endsWith('.md'));

  let mappedSource: string[] = [];
  let unmappedSource: string[] = [];

  if (changedSourceFiles.length > 0) {
    const rows = await neo4j.run(
      `UNWIND $files AS f
       OPTIONAL MATCH (sf:SourceFile)
       WHERE sf.projectId = $projectId
         AND (sf.filePath ENDS WITH f OR sf.name = last(split(f, '/')))
       WITH f, count(sf) AS matches
       RETURN f AS file, matches`,
      {
        files: changedSourceFiles,
        projectId: 'proj_c0d3e9a1f200',
      },
    );

    for (const row of rows) {
      const file = String(row.file ?? '');
      const matches = toNum(row.matches);
      if (!file) continue;
      if (matches > 0) mappedSource.push(file);
      else unmappedSource.push(file);
    }
  }

  let mappedPlans: string[] = [];
  let unmappedPlans: string[] = [];

  if (changedPlanFiles.length > 0) {
    const rows = await neo4j.run(
      `UNWIND $files AS f
       WITH f, last(split(f, '/')) AS filename
       OPTIONAL MATCH (n:CodeNode)
       WHERE n.filePath = filename
         AND n.projectId STARTS WITH 'plan_'
         AND n.coreType IN ['Task', 'Milestone', 'Section', 'Sprint', 'Decision', 'PlanProject']
       WITH f, count(n) AS matches
       RETURN f AS file, matches`,
      { files: changedPlanFiles },
    );

    for (const row of rows) {
      const file = String(row.file ?? '');
      const matches = toNum(row.matches);
      if (!file) continue;
      if (matches > 0) mappedPlans.push(file);
      else unmappedPlans.push(file);
    }
  }

  const sourceCoverage =
    changedSourceFiles.length > 0 ? mappedSource.length / changedSourceFiles.length : 1;
  const planCoverage = changedPlanFiles.length > 0 ? mappedPlans.length / changedPlanFiles.length : 1;

  const minSourceCoverage = Number(process.env.MIN_CHANGED_FILE_GRAPH_COVERAGE ?? 0.85);
  const minPlanCoverage = Number(process.env.MIN_CHANGED_PLAN_GRAPH_COVERAGE ?? 1.0);

  const ok =
    sourceCoverage >= minSourceCoverage &&
    planCoverage >= minPlanCoverage &&
    unmappedSource.length === 0 &&
    unmappedPlans.length === 0;

  return {
    key: 'coverage_drift_guardrails',
    ok,
    summary: ok
      ? 'Coverage drift guardrails passed.'
      : `Coverage drift guardrail failed (source=${sourceCoverage.toFixed(2)}, plan=${planCoverage.toFixed(2)})`,
    details: {
      changedSourceFiles,
      changedPlanFiles,
      mappedSource,
      unmappedSource,
      mappedPlans,
      unmappedPlans,
      sourceCoverage,
      planCoverage,
      minSourceCoverage,
      minPlanCoverage,
    },
  };
}

async function checkMilestoneQueryAnchorIntegrity(): Promise<InvariantResult> {
  const contractPath = join(process.cwd(), 'docs', 'QUERY_CONTRACT.md');
  const contract = readFileSync(contractPath, 'utf8');

  const q11Start = contract.indexOf('## Q11');
  const q11End = contract.indexOf('\n## ', q11Start + 1);
  const q11 = q11Start >= 0
    ? contract.slice(q11Start, q11End >= 0 ? q11End : undefined)
    : '';

  const hasPlanAnchor = q11.includes('MATCH (p:PlanProject');
  const hasMilestonePartOfPlan = q11.includes("MATCH (m:Milestone {projectId: 'plan_codegraph'})-[:PART_OF]->(p)");
  const hasTaskPartOfMilestone = q11.includes("OPTIONAL MATCH (t:Task {projectId: 'plan_codegraph'})-[:PART_OF]->(m)");
  const usesLineBucket = /\bCASE\s+WHEN\s+t\.line\b|\bt\.line\s*>?=|\bt\.line\s*<\b/i.test(q11);
  const usesFilePathFilter = /\bfilePath\b/i.test(q11);

  const ok = hasPlanAnchor && hasMilestonePartOfPlan && hasTaskPartOfMilestone && !usesLineBucket && !usesFilePathFilter;

  return {
    key: 'milestone_query_anchor_integrity',
    ok,
    summary: ok
      ? 'Milestone query anchor integrity passed.'
      : 'Milestone query anchor integrity failed (missing PlanProject anchor and/or line/filePath coupling detected).',
    details: {
      hasPlanAnchor,
      hasMilestonePartOfPlan,
      hasTaskPartOfMilestone,
      usesLineBucket,
      usesFilePathFilter,
    },
  };
}

async function checkDependencyDistinctGuard(): Promise<InvariantResult> {
  const contractPath = join(process.cwd(), 'docs', 'QUERY_CONTRACT.md');
  const contract = readFileSync(contractPath, 'utf8');

  const hasDistinctDependencyBlockers =
    contract.includes("count(DISTINCT CASE WHEN coalesce(d.status, 'planned') <> 'done' THEN d END)");

  const ok = hasDistinctDependencyBlockers;

  return {
    key: 'dependency_distinct_guard',
    ok,
    summary: ok
      ? 'Dependency DISTINCT guard passed.'
      : 'Dependency DISTINCT guard failed (canonical blocker query missing DISTINCT).',
    details: {
      hasDistinctDependencyBlockers,
    },
  };
}

async function checkNullStatusVisibilityGuard(): Promise<InvariantResult> {
  const contractPath = join(process.cwd(), 'docs', 'QUERY_CONTRACT.md');
  const contract = readFileSync(contractPath, 'utf8');

  const hasNullStatusCount = contract.includes('nullStatusCount');

  return {
    key: 'null_status_visibility_guard',
    ok: hasNullStatusCount,
    summary: hasNullStatusCount
      ? 'Null-status visibility guard passed.'
      : 'Null-status visibility guard failed (canonical status query missing nullStatusCount).',
    details: {
      hasNullStatusCount,
    },
  };
}

async function checkReadinessSemanticsContract(): Promise<InvariantResult> {
  const contractPath = join(process.cwd(), 'docs', 'QUERY_CONTRACT.md');
  const contract = readFileSync(contractPath, 'utf8');

  const hasDependsOnRule =
    contract.toLowerCase().includes('readiness semantics are defined only by `depends_on` edges');

  return {
    key: 'readiness_semantics_contract',
    ok: hasDependsOnRule,
    summary: hasDependsOnRule
      ? 'Readiness semantics contract passed.'
      : 'Readiness semantics contract failed (DEPENDS_ON-only rule missing from query contract).',
    details: {
      hasDependsOnRule,
    },
  };
}

async function checkS6BaselineOutputContract(): Promise<InvariantResult> {
  const verifyPath = join(process.cwd(), 'verify-graph-integrity.ts');
  const verifySource = readFileSync(verifyPath, 'utf8');

  const hasBaselineRefOutput = /\bbaselineRef\b/.test(verifySource);
  const hasBaselineTimestampOutput = /\bbaselineTimestamp\b/.test(verifySource);
  const hasBaselineSelector = /\bbaselineSelector\b/.test(verifySource);

  const ok = hasBaselineRefOutput && hasBaselineTimestampOutput && hasBaselineSelector;

  return {
    key: 's6_baseline_output_contract',
    ok,
    summary: ok
      ? 'S6 baseline output contract passed.'
      : 'S6 baseline output contract failed (missing baselineRef/baselineTimestamp/baselineSelector in verifier output path).',
    details: {
      hasBaselineRefOutput,
      hasBaselineTimestampOutput,
      hasBaselineSelector,
    },
  };
}

async function checkS5TrendSourceContract(): Promise<InvariantResult> {
  const trendPath = join(process.cwd(), 'src', 'utils', 'integrity-snapshot-trends.ts');
  const trendSource = readFileSync(trendPath, 'utf8');

  const usesIntegritySnapshot = trendSource.includes('MATCH (s:IntegritySnapshot)');
  const readsSnapshotFiles = /readdirSync|readFileSync\(.*integrity-snapshots/.test(trendSource);

  const ok = usesIntegritySnapshot && !readsSnapshotFiles;

  return {
    key: 's5_trend_source_contract',
    ok,
    summary: ok
      ? 'S5 trend-source contract passed.'
      : 'S5 trend-source contract failed (trend utility must read IntegritySnapshot graph data, not snapshot files).',
    details: {
      usesIntegritySnapshot,
      readsSnapshotFiles,
      trendPath,
    },
  };
}

async function checkDoneCheckGateCommand(): Promise<InvariantResult> {
  const packagePath = join(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  const doneCheck = pkg.scripts?.['done-check'] ?? '';

  const hasDoneCheck = doneCheck.length > 0;
  const hasGovernance = doneCheck.includes('registry:identity:verify') && doneCheck.includes('query:contract:verify');
  const hasParity = doneCheck.includes('parser:contracts:verify') && doneCheck.includes('plan:deps:verify');
  const hasIntegrity = doneCheck.includes('integrity:snapshot') && doneCheck.includes('integrity:verify');

  const ok = hasDoneCheck && hasGovernance && hasParity && hasIntegrity;

  return {
    key: 'done_check_gate_command',
    ok,
    summary: ok
      ? 'done-check gate command contract passed.'
      : 'done-check gate command contract failed (missing governance/parity/integrity chain).',
    details: {
      hasDoneCheck,
      hasGovernance,
      hasParity,
      hasIntegrity,
    },
  };
}

async function checkDoneCheckFailClosed(): Promise<InvariantResult> {
  const packagePath = join(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  const doneCheck = pkg.scripts?.['done-check'] ?? '';

  const usesAndChain = doneCheck.includes('&&');
  const hasUnsafeBypass = /\|\|\s*true/.test(doneCheck) || /;\s*npm run/.test(doneCheck);
  const ok = usesAndChain && !hasUnsafeBypass;

  return {
    key: 'done_check_fail_closed',
    ok,
    summary: ok
      ? 'done-check fail-closed behavior contract passed.'
      : 'done-check fail-closed behavior contract failed (non-fail-closed chaining detected).',
    details: {
      usesAndChain,
      hasUnsafeBypass,
    },
  };
}

async function checkGovernanceEvidenceArtifactRequirement(neo4j: Neo4jService): Promise<InvariantResult> {
  const rows = (await neo4j.run(
    `MATCH (v:VerificationRun {projectId: 'proj_c0d3e9a1f200'})
     WHERE v.artifactHash IS NOT NULL AND v.decisionHash IS NOT NULL
     RETURN count(v) AS runCount, max(v.ranAt) AS latestRanAt`,
  )) as Array<Record<string, unknown>>;

  const runCount = toNum(rows[0]?.runCount);
  const latestRanAt = String(rows[0]?.latestRanAt ?? '');

  const ok = runCount > 0 && latestRanAt.length > 0;

  return {
    key: 'governance_evidence_artifact_requirement',
    ok,
    summary: ok
      ? 'Governance evidence artifact requirement passed.'
      : 'Governance evidence artifact requirement failed (no artifact-linked verification runs found).',
    details: {
      runCount,
      latestRanAt,
    },
  };
}

async function checkStaleCheckDetector(): Promise<InvariantResult> {
  const packagePath = join(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> };
  const staleScript = pkg.scripts?.['governance:stale:verify'] ?? '';
  const doneCheck = pkg.scripts?.['done-check'] ?? '';

  const hasStaleScript = staleScript.includes('verify-governance-stale-check.ts');
  const wiredInDoneCheck = doneCheck.includes('governance:stale:verify');
  const ok = hasStaleScript && wiredInDoneCheck;

  return {
    key: 'stale_check_detector',
    ok,
    summary: ok
      ? 'Stale-check detector contract passed.'
      : 'Stale-check detector contract failed (missing script or done-check wiring).',
    details: {
      hasStaleScript,
      wiredInDoneCheck,
    },
  };
}

async function checkRecommendationDoneTaskGuard(neo4j: Neo4jService): Promise<InvariantResult> {
  const maxFreshnessMinutes = Number(process.env.PLAN_RECOMMENDATION_FRESHNESS_MAX_MINUTES ?? 30);

  const freshnessRows = await neo4j.run(
    `MATCH (p:Project)
     WHERE p.projectId STARTS WITH 'plan_'
     RETURN p.projectId AS projectId, p.lastParsed AS lastParsed`,
  );

  const staleProjects: Array<{ projectId: string; ageMinutes: number | null; lastParsed: string }> = [];
  const now = Date.now();

  for (const row of freshnessRows) {
    const projectId = String(row.projectId ?? '');
    const lastParsed = String(row.lastParsed ?? '');
    const parsedTs = Date.parse(lastParsed);
    if (!Number.isFinite(parsedTs)) {
      staleProjects.push({ projectId, ageMinutes: null, lastParsed });
      continue;
    }
    const ageMinutes = (now - parsedTs) / 60000;
    if (ageMinutes > maxFreshnessMinutes) {
      staleProjects.push({ projectId, ageMinutes: Math.round(ageMinutes), lastParsed });
    }
  }

  const recRows = await neo4j.run(
    `MATCH (t:Task)
     WHERE t.projectId STARTS WITH 'plan_'
       AND coalesce(t.status, 'planned') <> 'done'
       AND coalesce(t.status, 'planned') <> 'blocked'
     OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
     WITH t, count(DISTINCT CASE WHEN coalesce(dep.status, 'planned') <> 'done' THEN dep END) AS openDeps
     WHERE openDeps = 0
     RETURN
       count(t) AS recommendedCount,
       sum(CASE WHEN coalesce(t.status, 'planned') = 'done' THEN 1 ELSE 0 END) AS doneRecommendedCount`,
  );

  const recommendedCount = toNum(recRows[0]?.recommendedCount);
  const doneRecommendedCount = toNum(recRows[0]?.doneRecommendedCount);

  const hasFreshnessViolation = staleProjects.length > 0;
  const ok = doneRecommendedCount === 0 || hasFreshnessViolation;

  return {
    key: 'recommendation_done_task_guard',
    ok,
    summary: ok
      ? 'Recommendation done-task guard passed.'
      : `Recommendation guard failed: done tasks surfaced without freshness violation evidence (doneRecommended=${doneRecommendedCount})`,
    details: {
      recommendedCount,
      doneRecommendedCount,
      hasFreshnessViolation,
      maxFreshnessMinutes,
      staleProjects,
    },
  };
}

async function checkInvariantProofCompleteness(neo4j: Neo4jService): Promise<InvariantResult> {
  const rows = await neo4j.run(
    `MATCH (m:Milestone {projectId: 'plan_codegraph', code: 'VG-5'})
     MATCH (t:Task {projectId: 'plan_codegraph'})-[:PART_OF]->(m)
     WHERE t.name STARTS WITH 'Validate invariant:'
     OPTIONAL MATCH (:InvariantProof {projectId: 'plan_codegraph'})-[p:PROVES]->(t)
     WITH t, count(p) AS proofCount
     RETURN
       count(t) AS totalInvariantTasks,
       sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS doneTasks,
       sum(CASE WHEN t.status = 'done' AND (t.proofRunId IS NULL OR proofCount = 0) THEN 1 ELSE 0 END) AS doneWithoutProof,
       sum(CASE WHEN proofCount > 0 AND t.status <> 'done' THEN 1 ELSE 0 END) AS proofWithoutDone`,
  );

  const totalInvariantTasks = toNum(rows[0]?.totalInvariantTasks);
  const doneTasks = toNum(rows[0]?.doneTasks);
  const doneWithoutProof = toNum(rows[0]?.doneWithoutProof);
  const proofWithoutDone = toNum(rows[0]?.proofWithoutDone);

  const ok = doneWithoutProof === 0 && proofWithoutDone === 0;

  return {
    key: 'invariant_proof_completeness',
    ok,
    summary: ok
      ? 'Invariant proof completeness passed.'
      : `Invariant proof completeness failed (doneWithoutProof=${doneWithoutProof}, proofWithoutDone=${proofWithoutDone})`,
    details: {
      totalInvariantTasks,
      doneTasks,
      doneWithoutProof,
      proofWithoutDone,
    },
  };
}

function computeConfidence(invariants: InvariantResult[]): number {
  const total = invariants.length;
  if (total === 0) return 0;
  const failed = invariants.filter((i) => !i.ok).length;
  const score = Math.max(0, 1 - failed / total);
  return Number(score.toFixed(2));
}

function buildRoadmapLinks(failingKeys: InvariantKey[]): Array<{ invariant: InvariantKey; task: string; line: number }> {
  const links: Array<{ invariant: InvariantKey; task: string; line: number }> = [];
  for (const key of failingKeys) {
    for (const link of ROADMAP_LINKS[key] ?? []) {
      links.push({ invariant: key, task: link.task, line: link.line });
    }
  }
  return links;
}

function writeAuditArtifact(report: CommitAuditReport): string {
  const dir = join(process.cwd(), 'artifacts', 'commit-audit');
  mkdirSync(dir, { recursive: true });

  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const outPath = join(dir, `${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  return outPath;
}

async function main(): Promise<void> {
  const baseRef = process.argv[2] ?? 'HEAD~1';
  const headRef = process.argv[3] ?? 'HEAD';
  const generatedAt = new Date().toISOString();

  const changedFiles = getChangedFiles(baseRef, headRef);
  const commitCount = getCommitCount(baseRef, headRef);

  const neo4j = new Neo4jService();

  try {
    const invariants: InvariantResult[] = [];
    invariants.push(await checkSchemaIntegrity(neo4j));
    invariants.push(await checkEdgeTaxonomyIntegrity(neo4j));
    invariants.push(await checkDependencyIntegrity(neo4j));
    invariants.push(await checkParserContractIntegrity(neo4j));
    invariants.push(await checkCoverageDriftGuardrails(neo4j, changedFiles));
    invariants.push(await checkRecommendationDoneTaskGuard(neo4j));
    invariants.push(await checkInvariantProofCompleteness(neo4j));
    invariants.push(await checkMilestoneQueryAnchorIntegrity());
    invariants.push(await checkDependencyDistinctGuard());
    invariants.push(await checkNullStatusVisibilityGuard());
    invariants.push(await checkReadinessSemanticsContract());
    invariants.push(await checkS6BaselineOutputContract());
    invariants.push(await checkS5TrendSourceContract());
    invariants.push(await checkDoneCheckGateCommand());
    invariants.push(await checkDoneCheckFailClosed());
    invariants.push(await checkGovernanceEvidenceArtifactRequirement(neo4j));
    invariants.push(await checkStaleCheckDetector());

    const failingInvariantKeys = invariants.filter((i) => !i.ok).map((i) => i.key);
    const confidence = computeConfidence(invariants);
    const anomalyDeltas = readSnapshotDeltas();
    const roadmapTaskLinks = buildRoadmapLinks(failingInvariantKeys);

    const report: CommitAuditReport = {
      ok: failingInvariantKeys.length === 0,
      generatedAt,
      baseRef,
      headRef,
      commitCount,
      changedFiles,
      invariants,
      failingInvariantKeys,
      confidence,
      anomalyDeltas,
      roadmapTaskLinks,
    };

    const outPath = writeAuditArtifact(report);

    console.log(
      JSON.stringify({
        ok: report.ok,
        baseRef,
        headRef,
        commitCount,
        changedFiles: changedFiles.length,
        failingInvariantKeys,
        confidence,
        anomalyDeltaProjects: anomalyDeltas.length,
        roadmapLinks: roadmapTaskLinks.length,
        outPath,
      }),
    );

    process.exit(report.ok ? 0 : 1);
  } finally {
    await neo4j.getDriver().close();
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
