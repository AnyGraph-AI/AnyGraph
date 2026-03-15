/**
 * Ground Truth Hook — Integrity Hypothesis Generator (GTH-8)
 *
 * Reads Discrepancy nodes that have been open for N+ runs,
 * auto-generates Hypothesis nodes with GENERATED_HYPOTHESIS edges,
 * and wires them into the existing self-audit pipeline.
 *
 * Flow:
 *   Discrepancy (open, runsSinceDetected >= N)
 *     → Hypothesis (auto-created, status='open', domain='integrity')
 *       → enters self-audit getDriftItems() + applyVerdict()
 *
 * Default threshold: N=5 (configurable).
 * All MERGE keys include projectId for multi-project safety (A5-A6).
 */

import { Neo4jService } from '../../storage/neo4j/neo4j.service.js';

/** Configuration for the hypothesis generator */
export interface HypothesisGeneratorConfig {
  /** Number of consecutive failing runs before generating a hypothesis (default: 5) */
  threshold: number;
  /** Only generate for these severity levels (default: ['critical', 'warning']) */
  severityFilter: string[];
}

const DEFAULT_CONFIG: HypothesisGeneratorConfig = {
  threshold: 5,
  severityFilter: ['critical', 'warning'],
};

export interface GeneratedHypothesis {
  id: string;
  discrepancyId: string;
  name: string;
  type: string;
  runsSinceDetected: number;
}

export class IntegrityHypothesisGenerator {
  private readonly config: HypothesisGeneratorConfig;

  constructor(
    private readonly neo4j: Neo4jService,
    config?: Partial<HypothesisGeneratorConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scan open Discrepancies at or above the threshold. For each one that
   * doesn't already have a linked Hypothesis, create one.
   *
   * @param projectId — scope to a specific project (A5). If omitted, scans globally.
   * Returns the list of newly generated hypotheses.
   */
  async generateFromDiscrepancies(projectId?: string): Promise<GeneratedHypothesis[]> {
    const now = new Date().toISOString();

    // Find open discrepancies at threshold that have no hypothesis yet (E3: MATCH instead of OPTIONAL MATCH)
    const rows = await this.neo4j.run(
      `MATCH (disc:Discrepancy {status: 'open'})
       WHERE disc.runsSinceDetected >= $threshold
         AND ($projectId IS NULL OR disc.projectId = $projectId)
       MATCH (d:IntegrityFindingDefinition {id: disc.findingDefinitionId})
       WHERE d.severity IN $severities
       // Check no existing hypothesis link
       OPTIONAL MATCH (disc)-[:GENERATED_HYPOTHESIS]->(existing:Hypothesis)
       WITH disc, d, existing
       WHERE existing IS NULL
       RETURN disc.id AS discId,
              disc.type AS discType,
              disc.description AS description,
              disc.runsSinceDetected AS runs,
              disc.currentValue AS currentValue,
              d.severity AS severity`,
      {
        threshold: this.config.threshold,
        severities: this.config.severityFilter,
        projectId: projectId ?? null,
      },
    );

    // Always refresh existing hypothesis names/values from current discrepancy data
    await this.refreshExistingHypotheses(projectId);

    // Always resolve hypotheses for resolved discrepancies
    await this.resolveStaleHypotheses(projectId);

    if (rows.length === 0) {
      return [];
    }

    // Build hypotheses array in-memory (A5: projectId in hypId and ON CREATE SET)
    const projPrefix = projectId ?? 'global';
    const hypotheses = rows.map(row => {
      const discId = String(row.discId);
      const hypId = `hyp_integrity_${projPrefix}_${discId}`;
      const name = `Graph integrity: ${row.description} (${row.runs} consecutive failures, current=${row.currentValue})`;
      return {
        discId,
        hypId,
        name,
        discType: String(row.discType),
        severity: String(row.severity),
        now,
        runs: Number(row.runs),
        projectId: projectId ?? null,
      };
    });

    // Single batched UNWIND instead of N roundtrips
    await this.neo4j.run(
      `UNWIND $hypotheses AS h
       MATCH (disc:Discrepancy {id: h.discId})
       MERGE (hyp:Hypothesis {id: h.hypId})
       ON CREATE SET
         hyp.name = h.name,
         hyp.confidence = 0.0,
         hyp.status = 'open',
         hyp.domain = 'integrity',
         hyp.generatedFrom = 'integrity_discrepancy',
         hyp.sourceNodeId = h.discId,
         hyp.discrepancyType = h.discType,
         hyp.severity = h.severity,
         hyp.projectId = h.projectId,
         hyp.created = h.now
       ON MATCH SET
         hyp.updated = h.now,
         hyp.name = h.name
       MERGE (disc)-[:GENERATED_HYPOTHESIS]->(hyp)`,
      { hypotheses },
    );

    return hypotheses.map(h => ({
      id: h.hypId,
      discrepancyId: h.discId,
      name: h.name,
      type: h.discType,
      runsSinceDetected: h.runs,
    }));
  }

  /**
   * Refresh names/values on existing hypotheses from current discrepancy data.
   * Prevents stale counts (e.g. "current=1406" when actual is 0).
   */
  async refreshExistingHypotheses(projectId?: string): Promise<number> {
    const result = await this.neo4j.run(
      `MATCH (disc:Discrepancy {status: 'open'})-[:GENERATED_HYPOTHESIS]->(h:Hypothesis {status: 'open', domain: 'integrity'})
       WHERE $projectId IS NULL OR h.projectId = $projectId
       WITH disc, h,
            'Graph integrity: ' + disc.description + ' (' + toString(disc.runsSinceDetected) + ' consecutive failures, current=' + toString(disc.currentValue) + ')' AS freshName
       WHERE h.name <> freshName
       SET h.name = freshName,
           h.updated = toString(datetime())
       RETURN count(h) AS refreshed`,
      { projectId: projectId ?? null },
    );
    return Number(result[0]?.refreshed ?? 0);
  }

  /**
   * Close hypotheses whose underlying discrepancy is now resolved.
   * Prevents stale hypotheses from lingering after fixes.
   */
  async resolveStaleHypotheses(projectId?: string): Promise<number> {
    const result = await this.neo4j.run(
      `MATCH (disc:Discrepancy)-[:GENERATED_HYPOTHESIS]->(h:Hypothesis)
       WHERE h.status = 'open' AND h.domain = 'integrity'
         AND disc.status = 'resolved'
         AND ($projectId IS NULL OR h.projectId = $projectId)
       SET h.status = 'resolved',
           h.resolvedAt = toString(datetime()),
           h.resolvedReason = 'discrepancy ' + disc.id + ' resolved (currentValue=' + toString(disc.currentValue) + ')'
       RETURN count(h) AS resolved`,
      { projectId: projectId ?? null },
    );
    return Number(result[0]?.resolved ?? 0);
  }

  /**
   * Get all integrity hypotheses that are still open.
   * These are candidates for the self-audit pipeline's getDriftItems().
   *
   * @param projectId — scope to a specific project (A6). If omitted, returns all.
   */
  async getOpenIntegrityHypotheses(projectId?: string): Promise<GeneratedHypothesis[]> {
    const rows = await this.neo4j.run(
      `MATCH (disc:Discrepancy)-[:GENERATED_HYPOTHESIS]->(h:Hypothesis)
       WHERE h.status = 'open' AND h.domain = 'integrity'
         AND ($projectId IS NULL OR h.projectId = $projectId)
       RETURN h.id AS id,
              disc.id AS discId,
              h.name AS name,
              disc.type AS type,
              disc.runsSinceDetected AS runs
       ORDER BY disc.runsSinceDetected DESC`,
      { projectId: projectId ?? null },
    );

    return rows.map(r => ({
      id: String(r.id),
      discrepancyId: String(r.discId),
      name: String(r.name),
      type: String(r.type),
      runsSinceDetected: Number(r.runs),
    }));
  }
}
