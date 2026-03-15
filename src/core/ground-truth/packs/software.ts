/**
 * Software-Governance Pack (GTH-2)
 *
 * Concrete GroundTruthPack implementation for codegraph/plan governance.
 * All queries are parameterized (GRC-1: never hardcode counts or projectIds).
 * Uses GovernanceMetricSnapshot as primary governance source (GRC-3/7).
 */

import { Neo4jService } from '../../../storage/neo4j/neo4j.service.js';
import type { GroundTruthPack } from '../pack-interface.js';
import type {
  Observation,
  IntegrityFinding,
  TransitiveImpactClaim,
  CandidateEdge,
} from '../types.js';

function obs(value: unknown, source: string, fresh: boolean = true): Observation {
  return {
    value,
    observedAt: new Date().toISOString(),
    source,
    freshnessState: fresh ? 'fresh' : 'stale',
    confidenceClass: 'exact',
  };
}

export class SoftwareGovernancePack implements GroundTruthPack {
  readonly domain = 'software-governance';
  readonly version = '1.0.0';

  private neo4j: Neo4jService;

  constructor(neo4j?: Neo4jService) {
    this.neo4j = neo4j ?? new Neo4jService();
  }

  // ─── Panel 1A: Plan Status ──────────────────────────────────────

  async queryPlanStatus(projectId: string): Promise<Observation[]> {
    const observations: Observation[] = [];

    // Task counts by status
    const taskCounts = await this.neo4j.run(
      `MATCH (t:Task {projectId: $projectId})
       RETURN t.status AS status, count(t) AS cnt`,
      { projectId },
    );
    const statusMap: Record<string, number> = {};
    for (const row of taskCounts) {
      statusMap[String(row.status)] = Number(row.cnt);
    }
    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);
    observations.push(obs(
      { ...statusMap, total, pct: total > 0 ? Math.round(((statusMap.done ?? 0) / total) * 1000) / 10 : 0 },
      'Task',
    ));

    // Milestone completion
    const milestones = await this.neo4j.run(
      `MATCH (m:Milestone {projectId: $projectId})
       OPTIONAL MATCH (t:Task)-[:PART_OF]->(m)
       WITH m, count(t) AS total,
            sum(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
       RETURN m.name AS name, done, total ORDER BY m.name`,
      { projectId },
    );
    observations.push(obs(
      milestones.map(r => ({ name: r.name, done: Number(r.done), total: Number(r.total) })),
      'Milestone',
    ));

    // Unblocked tasks
    const unblocked = await this.neo4j.run(
      `MATCH (t:Task {status: 'planned', projectId: $projectId})
       OPTIONAL MATCH (t)-[:DEPENDS_ON]->(dep:Task)
       WITH t, collect(dep) AS deps, [d IN collect(dep) WHERE d.status <> 'done'] AS blockers
       WHERE size(blockers) = 0
       MATCH (t)-[:PART_OF]->(m:Milestone)
       RETURN m.name AS milestone, t.name AS task`,
      { projectId },
    );
    observations.push(obs(
      unblocked.map(r => ({ milestone: r.milestone, task: r.task })),
      'DEPENDS_ON',
    ));

    return observations;
  }

  // ─── Panel 1A: Governance Health ────────────────────────────────

  async queryGovernanceHealth(projectId: string): Promise<Observation[]> {
    const observations: Observation[] = [];

    // GovernanceMetricSnapshot — primary source (GRC-3/7)
    const gmsRows = await this.neo4j.run(
      `MATCH (g:GovernanceMetricSnapshot {projectId: $projectId})
       WITH g ORDER BY g.timestamp DESC LIMIT 1
       RETURN g.timestamp AS ts, g.verificationRuns AS runs,
              g.gateFailures AS failures, g.interceptionRate AS rate,
              g.invariantViolations AS violations`,
      { projectId },
    );

    if (gmsRows.length > 0) {
      const gms = gmsRows[0];
      const ageMs = Date.now() - new Date(String(gms.ts)).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      observations.push(obs(
        {
          verificationRuns: Number(gms.runs),
          gateFailures: Number(gms.failures),
          interceptionRate: Number(gms.rate),
          invariantViolations: Number(gms.violations),
          ageHours: Math.round(ageHours * 10) / 10,
        },
        'GovernanceMetricSnapshot',
        ageHours < 4,
      ));
    } else {
      observations.push(obs(
        { error: 'No GovernanceMetricSnapshot found' },
        'GovernanceMetricSnapshot',
        false,
      ));
    }

    return observations;
  }

  // ─── Panel 1A: Evidence Coverage ────────────────────────────────

  async queryEvidenceCoverage(projectId: string): Promise<Observation[]> {
    const rows = await this.neo4j.run(
      `MATCH (t:Task {status: 'done', projectId: $projectId})
       OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf)
       WITH t, count(sf) AS evCount
       RETURN
         CASE WHEN evCount > 0 THEN 'with_evidence' ELSE 'without' END AS bucket,
         count(t) AS cnt`,
      { projectId },
    );

    const buckets: Record<string, number> = {};
    for (const row of rows) {
      buckets[String(row.bucket)] = Number(row.cnt);
    }
    const withEv = buckets.with_evidence ?? 0;
    const without = buckets.without ?? 0;
    const total = withEv + without;

    return [obs(
      {
        withEvidence: withEv,
        withoutEvidence: without,
        total,
        pct: total > 0 ? Math.round((withEv / total) * 1000) / 10 : 0,
      },
      'HAS_CODE_EVIDENCE',
    )];
  }

  // ─── Panel 1A: Relevant Claims ──────────────────────────────────

  async queryRelevantClaims(
    taskId: string,
    filesTouched: string[],
    projectId?: string,
  ): Promise<Observation[]> {
    if (filesTouched.length === 0) return [];

    // Structural matching first: SUPPORTED_BY → ANCHORS → SourceFile
    // F4: Scoped to SourceFile label + projectId to avoid full graph scan
    const sfFilter = projectId
      ? 'MATCH (sf:SourceFile {projectId: $projectId}) WHERE sf.filePath ENDS WITH filePath OR sf.name = filePath'
      : 'MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH filePath OR sf.name = filePath';
    const structuralRows = await this.neo4j.run(
      `UNWIND $files AS filePath
       ${sfFilter}
       MATCH (c:Claim)-[:SUPPORTED_BY]->(e:Evidence)-[:ANCHORS]->(sf)
       RETURN DISTINCT c.id AS claimId, c.statement AS statement,
              c.confidence AS confidence, 'structural' AS matchMethod`,
      { files: filesTouched, projectId: projectId ?? null },
    );

    // Keyword fallback for files without structural matches
    const keywordRows = await this.neo4j.run(
      `UNWIND $files AS filePath
       MATCH (c:Claim)
       WHERE c.statement CONTAINS filePath
       RETURN DISTINCT c.id AS claimId, c.statement AS statement,
              c.confidence AS confidence, 'keyword' AS matchMethod`,
      { files: filesTouched },
    );

    // Deduplicate (structural wins)
    const seen = new Set(structuralRows.map(r => String(r.claimId)));
    const combined = [
      ...structuralRows,
      ...keywordRows.filter(r => !seen.has(String(r.claimId))),
    ];

    return combined.map(r => obs(
      {
        claimId: r.claimId,
        statement: r.statement,
        confidence: Number(r.confidence),
        matchMethod: r.matchMethod,
      },
      'Claim',
    ));
  }

  // ─── Panel 1B: Domain Integrity Surfaces ────────────────────────

  async queryIntegritySurfaces(projectId: string): Promise<IntegrityFinding[]> {
    const findings: IntegrityFinding[] = [];
    const now = new Date().toISOString();

    // Coverage: evidence gap
    try {
      const evRows = await this.neo4j.run(
        `MATCH (t:Task {status: 'done', projectId: $projectId})
         OPTIONAL MATCH (t)-[:HAS_CODE_EVIDENCE]->(sf)
         WITH count(t) AS total, sum(CASE WHEN sf IS NOT NULL THEN 1 ELSE 0 END) AS withEv
         RETURN total, withEv, total - withEv AS gap,
                CASE WHEN total > 0 THEN round(toFloat(total - withEv) / total * 1000) / 10 ELSE 0 END AS gapPct`,
        { projectId },
      );
      if (evRows.length > 0) {
        const r = evRows[0];
        findings.push({
          definitionId: 'evidence_gap',
          surface: 'coverage',
          surfaceClass: 'domain',
          severity: Number(r.gapPct) > 50 ? 'warning' : 'info',
          description: `${r.gap} done tasks lack HAS_CODE_EVIDENCE edges (${r.gapPct}% gap)`,
          observedValue: Number(r.gap),
          expectedValue: 0,
          pass: Number(r.gap) === 0,
          trend: 'new',
          tier: 'medium',
          observedAt: now,
        });
      }
    } catch { /* non-fatal */ }

    // Coverage: open hypotheses (cross-project intentionally — hypotheses are global reasoning artifacts)
    try {
      const hypRows = await this.neo4j.run(
        `MATCH (h:Hypothesis {status: 'open'})
         RETURN count(h) AS cnt`,
        {},
      );
      if (hypRows.length > 0) {
        const cnt = Number(hypRows[0].cnt);
        findings.push({
          definitionId: 'open_hypotheses',
          surface: 'coverage',
          surfaceClass: 'domain',
          severity: cnt > 100 ? 'warning' : 'info',
          description: `${cnt} open hypotheses unresolved`,
          observedValue: cnt,
          expectedValue: 0,
          pass: cnt === 0,
          trend: 'new',
          tier: 'medium',
          observedAt: now,
        });
      }
    } catch { /* non-fatal */ }

    // Semantic: contested claims (cross-project intentionally — claims span domains)
    try {
      const contestedRows = await this.neo4j.run(
        `MATCH (c:Claim)
         WHERE (c)-[:CONTRADICTED_BY]->()
         RETURN count(c) AS cnt`,
        {},
      );
      if (contestedRows.length > 0) {
        const cnt = Number(contestedRows[0].cnt);
        findings.push({
          definitionId: 'contested_claims',
          surface: 'semantic',
          surfaceClass: 'domain',
          severity: cnt > 20 ? 'warning' : 'info',
          description: `${cnt} claims have contradicting evidence`,
          observedValue: cnt,
          expectedValue: 0,
          pass: cnt === 0,
          trend: 'new',
          tier: 'heavy',
          observedAt: now,
        });
      }
    } catch { /* non-fatal */ }

    // Governance: gate failure trend
    try {
      const gateRows = await this.neo4j.run(
        `MATCH (g:GovernanceMetricSnapshot {projectId: $projectId})
         WITH g ORDER BY g.timestamp DESC LIMIT 5
         RETURN sum(toInteger(g.gateFailures)) AS totalFailures,
                count(g) AS snapshots`,
        { projectId },
      );
      if (gateRows.length > 0) {
        const failures = Number(gateRows[0].totalFailures);
        findings.push({
          definitionId: 'gate_failure_trend',
          surface: 'governance',
          surfaceClass: 'domain',
          severity: failures > 0 ? 'warning' : 'info',
          description: `${failures} gate failures in last 5 governance snapshots`,
          observedValue: failures,
          expectedValue: 0,
          pass: failures === 0,
          trend: 'new',
          tier: 'medium',
          observedAt: now,
        });
      }
    } catch { /* non-fatal */ }

    return findings;
  }

  // ─── Panel 3: Transitive Impact ─────────────────────────────────

  async queryTransitiveImpact(filesTouched: string[], projectId?: string): Promise<TransitiveImpactClaim[]> {
    if (filesTouched.length === 0) return [];

    // Structural matching: claims linked to files via SUPPORTED_BY → ANCHORS
    // F4: Scoped to SourceFile label + projectId to avoid full graph scan
    const sfFilter = projectId
      ? 'MATCH (sf:SourceFile {projectId: $projectId}) WHERE sf.filePath ENDS WITH filePath OR sf.name = filePath'
      : 'MATCH (sf:SourceFile) WHERE sf.filePath ENDS WITH filePath OR sf.name = filePath';
    const rows = await this.neo4j.run(
      `UNWIND $files AS filePath
       ${sfFilter}
       MATCH (c:Claim)-[:SUPPORTED_BY]->(e:Evidence)-[:ANCHORS]->(sf)
       WHERE c.claimType = 'transitive_impact'
       RETURN DISTINCT c.id AS claimId, c.statement AS statement,
              c.confidence AS confidence, collect(DISTINCT sf.filePath) AS files`,
      { files: filesTouched, projectId: projectId ?? null },
    );

    const results: TransitiveImpactClaim[] = rows
      .filter(r => r.claimId)
      .map(r => ({
        claimId: String(r.claimId),
        statement: String(r.statement),
        confidence: Number(r.confidence),
        affectedFiles: (r.files as string[]) ?? [],
        matchMethod: 'structural' as const,
      }));

    // Keyword fallback if structural found nothing
    if (results.length === 0) {
      const kwRows = await this.neo4j.run(
        `UNWIND $files AS filePath
         MATCH (c:Claim {claimType: 'transitive_impact'})
         WHERE c.statement CONTAINS filePath
         RETURN DISTINCT c.id AS claimId, c.statement AS statement,
                c.confidence AS confidence`,
        { files: filesTouched },
      );
      for (const r of kwRows) {
        results.push({
          claimId: String(r.claimId),
          statement: String(r.statement),
          confidence: Number(r.confidence),
          affectedFiles: filesTouched,
          matchMethod: 'keyword',
        });
      }
    }

    return results;
  }

  // ─── Panel 3: Candidate MODIFIES ────────────────────────────────

  async queryCandidateModifies(taskId: string, projectId?: string): Promise<CandidateEdge[]> {
    // Look for existing CANDIDATE_MODIFIES or keyword matches from task description
    const sfMatch = projectId
      ? 'MATCH (sf:SourceFile {projectId: $projectId})'
      : 'MATCH (sf:SourceFile)';
    const rows = await this.neo4j.run(
      `MATCH (t:Task) WHERE t.id = $taskId OR t.name = $taskId
       OPTIONAL MATCH (t)-[cm:CANDIDATE_MODIFIES]->(sf)
       WHERE sf IS NOT NULL
       RETURN t.name AS taskName, t.id AS tid,
              sf.filePath AS filePath, cm.confidence AS confidence,
              'task_description' AS source
       UNION ALL
       MATCH (t:Task) WHERE t.id = $taskId OR t.name = $taskId
       ${sfMatch}
       WHERE any(word IN split(toLower(t.name), ' ')
                 WHERE size(word) > 8
                 AND NOT word IN ['implement', 'integrate', 'refactor', 'verification', 'configure', 'establish']
                 AND toLower(sf.name) CONTAINS word)
       RETURN t.name AS taskName, t.id AS tid,
              sf.filePath AS filePath, 0.3 AS confidence,
              'keyword_match' AS source
       LIMIT 10`,
      { taskId, projectId: projectId ?? null },
    );

    return rows.map(r => ({
      taskId: String(r.tid),
      taskName: String(r.taskName),
      targetFilePath: String(r.filePath),
      confidence: Number(r.confidence ?? 0.3),
      source: r.source as CandidateEdge['source'],
    }));
  }

  async close(): Promise<void> {
    await this.neo4j.close();
  }
}
