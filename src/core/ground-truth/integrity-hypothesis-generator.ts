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
   * Returns the list of newly generated hypotheses.
   */
  async generateFromDiscrepancies(): Promise<GeneratedHypothesis[]> {
    const now = new Date().toISOString();

    // Find open discrepancies at threshold that have no hypothesis yet
    const rows = await this.neo4j.run(
      `MATCH (disc:Discrepancy {status: 'open'})
       WHERE disc.runsSinceDetected >= $threshold
       // Filter by severity of the parent definition
       OPTIONAL MATCH (d:IntegrityFindingDefinition {id: disc.findingDefinitionId})
       WHERE d.severity IN $severities
       WITH disc, d
       WHERE d IS NOT NULL
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
      },
    );

    if (rows.length === 0) return [];

    // Build hypotheses array in-memory
    const hypotheses = rows.map(row => {
      const discId = String(row.discId);
      const hypId = `hyp_integrity_${discId}`;
      const name = `Graph integrity: ${row.description} (${row.runs} consecutive failures, current=${row.currentValue})`;
      return {
        discId,
        hypId,
        name,
        discType: String(row.discType),
        severity: String(row.severity),
        now,
        runs: Number(row.runs),
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
   * Get all integrity hypotheses that are still open.
   * These are candidates for the self-audit pipeline's getDriftItems().
   */
  async getOpenIntegrityHypotheses(): Promise<GeneratedHypothesis[]> {
    const rows = await this.neo4j.run(
      `MATCH (disc:Discrepancy)-[:GENERATED_HYPOTHESIS]->(h:Hypothesis)
       WHERE h.status = 'open' AND h.domain = 'integrity'
       RETURN h.id AS id,
              disc.id AS discId,
              h.name AS name,
              disc.type AS type,
              disc.runsSinceDetected AS runs
       ORDER BY disc.runsSinceDetected DESC`,
      {},
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
