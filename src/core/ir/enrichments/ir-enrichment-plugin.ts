/**
 * IR Enrichment Plugin Interface
 *
 * Enrichment plugins transform an IR document between parser output and materialization.
 * They can add nodes, edges, or modify existing properties — but they do NOT touch Neo4j.
 * The materializer handles persistence.
 *
 * Use cases:
 *   - Framework detection (Grammy, Express, NestJS, React) → Entrypoint/Route/Component nodes
 *   - State analysis (session reads/writes) → READS_STATE/WRITES_STATE edges
 *   - Heuristic enrichment (complexity scoring, naming convention detection)
 */

import { IrDocument } from '../ir-v1.schema.js';

export interface IrEnrichmentResult {
  /** Number of nodes added by this enrichment */
  nodesAdded: number;
  /** Number of edges added by this enrichment */
  edgesAdded: number;
  /** Number of existing nodes modified */
  nodesModified: number;
  /** Plugin name for logging */
  pluginName: string;
}

export interface IrEnrichmentPlugin {
  /** Unique plugin name (e.g., 'grammy', 'express', 'react') */
  readonly name: string;

  /**
   * Check whether this plugin should run on the given IR document.
   * Fast check — scan imports/metadata, don't traverse all nodes.
   */
  shouldEnrich(doc: IrDocument): boolean;

  /**
   * Enrich the IR document in-place. Adds nodes/edges, modifies properties.
   * Returns stats for logging.
   */
  enrich(doc: IrDocument): IrEnrichmentResult;
}

/**
 * Run all applicable enrichment plugins on an IR document.
 * Returns the enriched document (mutated in-place) and combined stats.
 */
export function applyIrEnrichments(
  doc: IrDocument,
  plugins: IrEnrichmentPlugin[],
): { doc: IrDocument; results: IrEnrichmentResult[] } {
  const results: IrEnrichmentResult[] = [];

  for (const plugin of plugins) {
    if (plugin.shouldEnrich(doc)) {
      const result = plugin.enrich(doc);
      results.push(result);
    }
  }

  return { doc, results };
}
