/**
 * Sampled Production Subgraphs — Nightly Path
 *
 * These fixtures sample real production graph data for nightly test runs.
 * Larger than scenario fixtures but still bounded for CI feasibility.
 *
 * @version 1.0.0
 * @see plans/codegraph/TDD_ROADMAP.md — Milestone N3, Sampled Fixtures
 */

import type { QueryResult } from 'neo4j-driver';
import type { TestFixture } from '../../ephemeral-graph.js';

export const SAMPLED_FIXTURE_VERSION = '1.0.0';

/**
 * Sample a subgraph from the production database for testing.
 * Extracts nodes and edges matching a projectId, limited to maxNodes.
 */
export async function sampleProductionSubgraph(
  run: (cypher: string, params?: Record<string, unknown>) => Promise<QueryResult>,
  projectId: string,
  maxNodes: number = 100
): Promise<TestFixture> {
  // Sample nodes
  const nodeResult = await run(`
    MATCH (n {projectId: $projectId})
    WITH n LIMIT $maxNodes
    RETURN labels(n) AS labels, properties(n) AS props
  `, { projectId, maxNodes });

  const nodes: TestFixture['nodes'] = nodeResult.records.map((r, i) => ({
    labels: r.get('labels') as string[],
    properties: r.get('props') as Record<string, unknown>,
    ref: `sampled_${i}`,
  }));

  // Note: edges between sampled nodes would need a second query
  // For now, return node-only fixture (edges added in future iteration)
  return { nodes, edges: [] };
}
