/**
 * Ground Truth Hook — Integrity Finding Persistence (GTH-7)
 *
 * Persists IntegrityFindingDefinition and IntegrityFindingObservation nodes
 * in Neo4j, creates Discrepancy nodes for failing checks, and maintains
 * resolution trail edges.
 *
 * Node lifecycle:
 *   IntegrityFindingDefinition (stable, MERGE by id)
 *     -[:OBSERVED_AS]-> IntegrityFindingObservation (temporal, one per run)
 *       -[:PRODUCED]-> Discrepancy (created when observation fails)
 *
 * Resolution trail edges (created by other systems):
 *   (Discrepancy)-[:GENERATED_HYPOTHESIS]->(Hypothesis)
 *   (Hypothesis)-[:BECAME_TASK]->(Task)
 *   (Task)-[:RESOLVED_BY_COMMIT]->(commitSnapshot)
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';
import type {
  IntegrityFinding,
  DiscrepancyType,
  FindingTrend,
} from './types.js';

/** Discrepancy node as stored in Neo4j */
export interface DiscrepancyNode {
  id: string;
  type: DiscrepancyType;
  findingDefinitionId: string;
  description: string;
  firstObservedAt: string;
  lastObservedAt: string;
  currentValue: number;
  expectedValue: number;
  trend: FindingTrend;
  runsSinceDetected: number;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
}

/** Map finding surface → discrepancy type */
function classifyDiscrepancy(finding: IntegrityFinding): DiscrepancyType {
  switch (finding.surface) {
    case 'schema':
      return 'StructuralViolation';
    case 'referential':
      return 'ReferentialDrift';
    case 'provenance':
      return finding.definitionId.includes('coverage') ? 'CoverageGap' : 'EvidenceGap';
    case 'freshness':
      return 'FreshnessBreach';
    case 'coverage':
      return finding.definitionId.includes('evidence') ? 'EvidenceGap' : 'CoverageGap';
    case 'semantic':
      return 'SemanticConflict';
    case 'governance':
      return 'CoverageGap';
    default:
      return 'ObservedUnmodeledReality';
  }
}

export class IntegrityPersistence {
  constructor(private readonly neo4j: Neo4jService) {}

  /**
   * Persist all findings from a ground truth run.
   * Creates/updates definitions, creates observations, manages discrepancies.
   *
   * Batched: ~5 Neo4j roundtrips instead of ~60 (N+1 eliminated).
   *
   * Returns: { definitionsMerged, observationsCreated, discrepanciesOpen, discrepanciesResolved }
   */
  async persistFindings(
    findings: IntegrityFinding[],
    projectId: string,
  ): Promise<{
    definitionsMerged: number;
    observationsCreated: number;
    discrepanciesOpen: number;
    discrepanciesResolved: number;
  }> {
    const now = new Date().toISOString();
    const runTs = Date.now();

    if (findings.length === 0) {
      return { definitionsMerged: 0, observationsCreated: 0, discrepanciesOpen: 0, discrepanciesResolved: 0 };
    }

    // Prepare all findings with unique obsIds
    const prepared = findings.map((f, i) => ({
      ...f,
      obsId: `obs_${f.definitionId}_${runTs}_${i}`,
    }));

    // Step 1: Batch MERGE all definitions
    const defs = prepared.map(f => ({
      definitionId: f.definitionId,
      surface: f.surface,
      surfaceClass: f.surfaceClass,
      severity: f.severity,
      description: f.description,
      expected: f.expectedValue,
      projectId,
      now,
    }));

    await this.neo4j.run(
      `UNWIND $defs AS f
       MERGE (d:IntegrityFindingDefinition {id: f.definitionId})
       ON CREATE SET
         d.surface = f.surface,
         d.surfaceClass = f.surfaceClass,
         d.severity = f.severity,
         d.description = f.description,
         d.expected = f.expected,
         d.projectId = f.projectId,
         d.createdAt = f.now
       ON MATCH SET
         d.severity = f.severity,
         d.description = f.description,
         d.expected = f.expected,
         d.updatedAt = f.now`,
      { defs },
    );
    const definitionsMerged = defs.length;

    // Step 2: Batch fetch ALL previous observation values for trend computation
    const defIds = [...new Set(prepared.map(f => f.definitionId))];
    const trendRows = await this.neo4j.run(
      `UNWIND $defIds AS defId
       MATCH (d:IntegrityFindingDefinition {id: defId})-[:OBSERVED_AS]->(o:IntegrityFindingObservation)
       WITH defId, o ORDER BY o.observedAt DESC
       WITH defId, collect(o.observedValue)[0] AS lastVal
       RETURN defId, lastVal`,
      { defIds },
    );
    const lastValues = new Map<string, number>();
    for (const row of trendRows) {
      lastValues.set(String(row.defId), Number(row.lastVal));
    }

    // Compute trends in-memory
    const computeTrend = (defId: string, currentValue: number): FindingTrend => {
      const prev = lastValues.get(defId);
      if (prev === undefined) return 'new';
      if (currentValue < prev) return 'improving';
      if (currentValue > prev) return 'degrading';
      return 'stable';
    };

    // Step 3: Batch CREATE all observations + OBSERVED_AS edges
    const obs = prepared.map(f => ({
      definitionId: f.definitionId,
      obsId: f.obsId,
      observedAt: f.observedAt,
      observedValue: f.observedValue,
      expectedValue: f.expectedValue,
      pass: f.pass,
      tier: f.tier,
      trend: computeTrend(f.definitionId, f.observedValue),
    }));

    await this.neo4j.run(
      `UNWIND $obs AS o
       MATCH (d:IntegrityFindingDefinition {id: o.definitionId})
       CREATE (ob:IntegrityFindingObservation {
         id: o.obsId,
         observedAt: o.observedAt,
         observedValue: o.observedValue,
         expectedValue: o.expectedValue,
         pass: o.pass,
         source: 'ground_truth_hook',
         tier: o.tier,
         trend: o.trend
       })
       CREATE (d)-[:OBSERVED_AS]->(ob)`,
      { obs },
    );
    const observationsCreated = obs.length;

    // Step 4: Batch MERGE all failing discrepancies + PRODUCED edges
    const failing = prepared
      .filter(f => !f.pass)
      .map(f => {
        const trend = computeTrend(f.definitionId, f.observedValue);
        return {
          obsId: f.obsId,
          discId: `disc_${f.definitionId}`,
          discType: classifyDiscrepancy(f),
          defId: f.definitionId,
          description: f.description,
          now,
          currentValue: f.observedValue,
          expectedValue: f.expectedValue,
          trend,
        };
      });

    let discrepanciesOpen = 0;
    if (failing.length > 0) {
      await this.neo4j.run(
        `UNWIND $failing AS f
         MATCH (o:IntegrityFindingObservation {id: f.obsId})
         MERGE (disc:Discrepancy {id: f.discId})
         ON CREATE SET
           disc.type = f.discType,
           disc.findingDefinitionId = f.defId,
           disc.description = f.description,
           disc.firstObservedAt = f.now,
           disc.lastObservedAt = f.now,
           disc.currentValue = f.currentValue,
           disc.expectedValue = f.expectedValue,
           disc.trend = f.trend,
           disc.runsSinceDetected = 1,
           disc.status = 'open'
         ON MATCH SET
           disc.lastObservedAt = f.now,
           disc.currentValue = f.currentValue,
           disc.trend = f.trend,
           disc.runsSinceDetected = disc.runsSinceDetected + 1,
           disc.status = 'open'
         CREATE (o)-[:PRODUCED]->(disc)`,
        { failing },
      );
      discrepanciesOpen = failing.length;
    }

    // Step 5: Batch resolve all passing discrepancies
    const passingDefIds = prepared.filter(f => f.pass).map(f => f.definitionId);
    let discrepanciesResolved = 0;
    if (passingDefIds.length > 0) {
      const resolved = await this.neo4j.run(
        `UNWIND $passingDefIds AS defId
         MATCH (disc:Discrepancy {findingDefinitionId: defId, status: 'open'})
         SET disc.status = 'resolved', disc.resolvedAt = $now
         RETURN count(disc) AS cnt`,
        { passingDefIds, now },
      );
      if (resolved.length > 0) {
        discrepanciesResolved = Number(resolved[0].cnt);
      }
    }

    return { definitionsMerged, observationsCreated, discrepanciesOpen, discrepanciesResolved };
  }

  /**
   * Get all open discrepancies, optionally filtered by type or severity threshold.
   */
  async getOpenDiscrepancies(opts?: {
    type?: DiscrepancyType;
    minRuns?: number;
  }): Promise<DiscrepancyNode[]> {
    const typeFilter = opts?.type ? `AND disc.type = $type` : '';
    const runsFilter = opts?.minRuns ? `AND disc.runsSinceDetected >= $minRuns` : '';

    const rows = await this.neo4j.run(
      `MATCH (disc:Discrepancy {status: 'open'})
       WHERE true ${typeFilter} ${runsFilter}
       RETURN properties(disc) AS props
       ORDER BY disc.runsSinceDetected DESC`,
      { type: opts?.type ?? null, minRuns: opts?.minRuns ?? null },
    );

    return rows.map(r => r.props as DiscrepancyNode);
  }

  /**
   * Link a Discrepancy to a Hypothesis via GENERATED_HYPOTHESIS edge.
   */
  async linkDiscrepancyToHypothesis(discrepancyId: string, hypothesisId: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (disc:Discrepancy {id: $discId})
       MATCH (h:Hypothesis {id: $hypId})
       MERGE (disc)-[:GENERATED_HYPOTHESIS]->(h)`,
      { discId: discrepancyId, hypId: hypothesisId },
    );
  }

  /**
   * Link a Hypothesis to a Task via BECAME_TASK edge.
   */
  async linkHypothesisToTask(hypothesisId: string, taskId: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (h:Hypothesis {id: $hypId})
       MATCH (t:Task {id: $taskId})
       MERGE (h)-[:BECAME_TASK]->(t)`,
      { hypId: hypothesisId, taskId },
    );
  }

  /**
   * Link a Task to a commit via RESOLVED_BY_COMMIT edge.
   */
  async linkTaskToCommit(taskId: string, commitSha: string): Promise<void> {
    await this.neo4j.run(
      `MATCH (t:Task {id: $taskId})
       MERGE (cs:CommitSnapshot {sha: $sha})
       ON CREATE SET cs.createdAt = datetime()
       MERGE (t)-[:RESOLVED_BY_COMMIT]->(cs)`,
      { taskId, sha: commitSha },
    );
  }
}
