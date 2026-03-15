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
    let definitionsMerged = 0;
    let observationsCreated = 0;
    let discrepanciesOpen = 0;
    let discrepanciesResolved = 0;

    // Process all findings
    for (const finding of findings) {
      // 1. MERGE IntegrityFindingDefinition
      await this.neo4j.run(
        `MERGE (d:IntegrityFindingDefinition {id: $definitionId})
         ON CREATE SET
           d.surface = $surface,
           d.surfaceClass = $surfaceClass,
           d.severity = $severity,
           d.description = $description,
           d.expected = $expected,
           d.projectId = $projectId,
           d.createdAt = $now
         ON MATCH SET
           d.severity = $severity,
           d.description = $description,
           d.expected = $expected,
           d.updatedAt = $now`,
        {
          definitionId: finding.definitionId,
          surface: finding.surface,
          surfaceClass: finding.surfaceClass,
          severity: finding.severity,
          description: finding.description,
          expected: finding.expectedValue,
          projectId,
          now,
        },
      );
      definitionsMerged++;

      // 2. CREATE IntegrityFindingObservation + link to definition
      const obsId = `obs_${finding.definitionId}_${Date.now()}`;
      const trend = await this.computeTrend(finding.definitionId, finding.observedValue);

      await this.neo4j.run(
        `MATCH (d:IntegrityFindingDefinition {id: $definitionId})
         CREATE (o:IntegrityFindingObservation {
           id: $obsId,
           observedAt: $observedAt,
           observedValue: $observedValue,
           expectedValue: $expectedValue,
           pass: $pass,
           source: 'ground_truth_hook',
           tier: $tier,
           trend: $trend
         })
         CREATE (d)-[:OBSERVED_AS]->(o)`,
        {
          definitionId: finding.definitionId,
          obsId,
          observedAt: finding.observedAt,
          observedValue: finding.observedValue,
          expectedValue: finding.expectedValue,
          pass: finding.pass,
          tier: finding.tier,
          trend,
        },
      );
      observationsCreated++;

      // 3. Manage Discrepancy nodes
      if (!finding.pass) {
        // Failing: create or update Discrepancy
        const discType = classifyDiscrepancy(finding);
        const discId = `disc_${finding.definitionId}`;

        await this.neo4j.run(
          `MATCH (o:IntegrityFindingObservation {id: $obsId})
           MERGE (disc:Discrepancy {id: $discId})
           ON CREATE SET
             disc.type = $discType,
             disc.findingDefinitionId = $defId,
             disc.description = $description,
             disc.firstObservedAt = $now,
             disc.lastObservedAt = $now,
             disc.currentValue = $currentValue,
             disc.expectedValue = $expectedValue,
             disc.trend = $trend,
             disc.runsSinceDetected = 1,
             disc.status = 'open'
           ON MATCH SET
             disc.lastObservedAt = $now,
             disc.currentValue = $currentValue,
             disc.trend = $trend,
             disc.runsSinceDetected = disc.runsSinceDetected + 1,
             disc.status = 'open'
           CREATE (o)-[:PRODUCED]->(disc)`,
          {
            obsId,
            discId,
            discType,
            defId: finding.definitionId,
            description: finding.description,
            now,
            currentValue: finding.observedValue,
            expectedValue: finding.expectedValue,
            trend,
          },
        );
        discrepanciesOpen++;
      } else {
        // Passing: resolve any existing open Discrepancy
        const resolved = await this.neo4j.run(
          `MATCH (disc:Discrepancy {
             findingDefinitionId: $defId,
             status: 'open'
           })
           SET disc.status = 'resolved',
               disc.resolvedAt = $now
           RETURN count(disc) AS cnt`,
          { defId: finding.definitionId, now },
        );
        if (resolved.length > 0 && Number(resolved[0].cnt) > 0) {
          discrepanciesResolved += Number(resolved[0].cnt);
        }
      }
    }

    return { definitionsMerged, observationsCreated, discrepanciesOpen, discrepanciesResolved };
  }

  /**
   * Compute trend by comparing current value against last observation.
   */
  private async computeTrend(definitionId: string, currentValue: number): Promise<FindingTrend> {
    const rows = await this.neo4j.run(
      `MATCH (d:IntegrityFindingDefinition {id: $defId})-[:OBSERVED_AS]->(o:IntegrityFindingObservation)
       RETURN o.observedValue AS val
       ORDER BY o.observedAt DESC
       LIMIT 1`,
      { defId: definitionId },
    );

    if (rows.length === 0) return 'new';

    const previousValue = Number(rows[0].val);
    if (currentValue < previousValue) return 'improving';
    if (currentValue > previousValue) return 'degrading';
    return 'stable';
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
